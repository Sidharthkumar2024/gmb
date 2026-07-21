import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, AuthTokenPurpose } from "@nexaflow/db";
import { ApiError, ErrorCodes, type RoleName } from "@nexaflow/shared";
import {
  signAccessToken,
  requireAuth,
  accessTokenTtlSeconds,
  type RequestWithAuth,
} from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserSessions,
  issueAuthToken,
  consumeAuthToken,
} from "../services/authToken.service";
import { sendEmail } from "../services/email.service";
import { extractRequestMeta } from "../services/audit.service";

const router = Router();

const BCRYPT_ROUNDS = 10;

function publicUser(u: {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  tenantId: string | null;
  emailVerified: boolean;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? "",
    role: u.role,
    status: u.status,
    tenantId: u.tenantId,
    emailVerified: u.emailVerified,
  };
}

function requestMeta(req: Request) {
  const { ipAddress, userAgent } = extractRequestMeta(req);
  return { ipAddress, userAgent };
}

function webUrl(): string {
  return process.env.WEB_URL ?? "http://localhost:3000";
}

// --- login ------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  "/login",
  rateLimit({ name: "login", max: 10, windowSeconds: 900, keyOn: "email" }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(ErrorCodes.VALIDATION_ERROR, 400, "Email and password are required.");
      }
      const { email, password } = parsed.data;

      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        include: { tenant: { select: { name: true, status: true } } },
      });

      // One message for "no such user" and "wrong password" — distinguishable
      // responses would let anyone enumerate registered emails.
      const invalid = new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Invalid email or password.");
      if (!user || !user.isActive) throw invalid;
      if (!(await bcrypt.compare(password, user.password))) throw invalid;

      if (user.status !== "ACTIVE") {
        throw new ApiError(ErrorCodes.FORBIDDEN, 403, "This account is not active.");
      }
      if (user.tenant.status !== "ACTIVE") {
        throw new ApiError(ErrorCodes.FORBIDDEN, 403, "This workspace is not active.");
      }

      const accessToken = signAccessToken({
        sub: user.id,
        tenantId: user.tenantId,
        role: user.role as RoleName,
      });
      const { refreshToken } = await issueRefreshToken(user.id, requestMeta(req));

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      res.json({
        success: true,
        data: {
          accessToken,
          refreshToken,
          expiresIn: accessTokenTtlSeconds(),
          user: publicUser(user),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- signup -----------------------------------------------------------------

const signupSchema = z.object({
  email: z.string().email(),
  // 8 is the floor; length beats composition rules for real-world strength.
  password: z.string().min(8, "Password must be at least 8 characters."),
  // The sign-up form asks for the business, not the person, so `name` is
  // optional and falls back to the email's local part.
  name: z.string().min(1).optional(),
  companyName: z.string().min(1),
  // Optional profile hints from the form. `category` seeds the tenant's
  // industry (which drives niche-aware AI copy) and `city` seeds the first
  // location, so a new workspace has something to work with instead of an
  // empty Locations screen.
  city: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
});

router.post(
  "/signup",
  rateLimit({ name: "signup", max: 5, windowSeconds: 3600 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = signupSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError(
          ErrorCodes.VALIDATION_ERROR,
          400,
          parsed.error.issues[0]?.message ?? "Invalid signup details.",
        );
      }
      const { email, password, companyName, city, category } = parsed.data;
      const normalized = email.toLowerCase();
      // The form asks for the business, not the person; fall back to the
      // email's local part so the account always has something to greet with.
      const name = parsed.data.name ?? normalized.split("@")[0];

      const existing = await prisma.user.findUnique({ where: { email: normalized } });
      if (existing) {
        // Same shape and status as success: telling an anonymous caller that an
        // address is registered is an account-enumeration leak.
        res.status(201).json({
          success: true,
          data: {
            user: null,
            message: "Check your email to finish setting up your account.",
          },
        });
        return;
      }

      // Slug must be unique; derive from the company name and disambiguate.
      const base =
        companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
      let slug = base;
      for (let i = 2; await prisma.tenant.findUnique({ where: { slug } }); i += 1) {
        slug = `${base}-${i}`;
      }

      const user = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: companyName, slug, ...(category ? { industry: category } : {}) },
        });
        // Every workspace gets a wallet so AI-credit reads never hit a null.
        await tx.wallet.create({
          data: {
            tenantId: tenant.id,
            balanceCredits: Number(process.env.SIGNUP_BONUS_CREDITS ?? 100),
          },
        });
        // Seed the first location from what the form already asked for, so a
        // new workspace opens onto real content instead of an empty state.
        // It is a local draft until the owner connects Google and maps it —
        // nothing here claims to be verified or synced.
        await tx.gmbLocation.create({
          data: {
            tenantId: tenant.id,
            name: companyName,
            ...(city ? { city } : {}),
            ...(category ? { primaryCategory: category } : {}),
          },
        });
        return tx.user.create({
          data: {
            tenantId: tenant.id,
            email: normalized,
            name,
            password: await bcrypt.hash(password, BCRYPT_ROUNDS),
            role: "BUSINESS_ADMIN",
          },
        });
      });

      const { token } = await issueAuthToken(user.id, AuthTokenPurpose.EMAIL_VERIFY);
      await sendEmail({
        to: normalized,
        subject: "Verify your email",
        text: `Welcome to Adgrowly. Verify your email: ${webUrl()}/verify-email?token=${token}`,
      }).catch((e) => console.error("[auth] verification email failed", e));

      res.status(201).json({
        success: true,
        data: {
          user: publicUser({ ...user, tenantId: user.tenantId }),
          message: "Check your email to finish setting up your account.",
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- session lifecycle ------------------------------------------------------

router.post("/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawToken = String((req.body as { refreshToken?: string })?.refreshToken ?? "");
    if (!rawToken) {
      throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Refresh token required.");
    }
    const rotated = await rotateRefreshToken(rawToken, requestMeta(req));

    const user = await prisma.user.findUnique({
      where: { id: rotated.userId },
      include: { tenant: { select: { status: true } } },
    });
    if (!user || !user.isActive || user.status !== "ACTIVE" || user.tenant.status !== "ACTIVE") {
      throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "Account is not active.");
    }

    res.json({
      success: true,
      data: {
        accessToken: signAccessToken({
          sub: user.id,
          tenantId: user.tenantId,
          role: user.role as RoleName,
        }),
        refreshToken: rotated.refreshToken,
        expiresIn: accessTokenTtlSeconds(),
        user: publicUser(user),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawToken = String((req.body as { refreshToken?: string })?.refreshToken ?? "");
    if (rawToken) await revokeRefreshToken(rawToken);
    // Always 200: sign-out must succeed even with a stale or missing token,
    // otherwise the client is stuck unable to clear its session.
    res.json({ success: true, data: { message: "Signed out." } });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      include: { tenant: { select: { name: true, industry: true, timezone: true } } },
    });
    if (!user) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "User not found.");
    res.json({
      success: true,
      data: { user: publicUser(user), tenant: user.tenant },
    });
  } catch (err) {
    next(err);
  }
});

// --- email verification -----------------------------------------------------

router.post("/verify-email", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String((req.body as { token?: string })?.token ?? "");
    if (!token) throw new ApiError(ErrorCodes.VALIDATION_ERROR, 400, "Token is required.");

    const { userId } = await consumeAuthToken(token, AuthTokenPurpose.EMAIL_VERIFY);
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
    res.json({ success: true, data: { message: "Email verified." } });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/resend-verification",
  rateLimit({ name: "resend-verification", max: 3, windowSeconds: 3600, keyOn: "email" }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = String((req.body as { email?: string })?.email ?? "").toLowerCase();
      const user = email ? await prisma.user.findUnique({ where: { email } }) : null;

      if (user && !user.emailVerified) {
        const { token } = await issueAuthToken(user.id, AuthTokenPurpose.EMAIL_VERIFY);
        await sendEmail({
          to: email,
          subject: "Verify your email",
          text: `Verify your email: ${webUrl()}/verify-email?token=${token}`,
        }).catch((e) => console.error("[auth] verification email failed", e));
      }

      // Unconditional success — see request-password-reset.
      res.json({
        success: true,
        data: { message: "If that address needs verifying, we've sent a link." },
      });
    } catch (err) {
      next(err);
    }
  },
);

// --- password reset ---------------------------------------------------------

router.post(
  "/request-password-reset",
  rateLimit({ name: "request-password-reset", max: 5, windowSeconds: 3600, keyOn: "email" }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = String((req.body as { email?: string })?.email ?? "").toLowerCase();
      const user = email ? await prisma.user.findUnique({ where: { email } }) : null;

      if (user && user.isActive) {
        const { token } = await issueAuthToken(user.id, AuthTokenPurpose.PASSWORD_RESET);
        await sendEmail({
          to: email,
          subject: "Reset your password",
          text: `Reset your password: ${webUrl()}/reset-password?token=${token}\n\nIf you didn't request this, ignore this email.`,
        }).catch((e) => console.error("[auth] reset email failed", e));
      }

      // Identical response whether or not the address exists — the difference
      // would otherwise reveal who has an account.
      res.json({
        success: true,
        data: { message: "If that address has an account, we've sent a reset link." },
      });
    } catch (err) {
      next(err);
    }
  },
);

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

router.post("/reset-password", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(
        ErrorCodes.VALIDATION_ERROR,
        400,
        parsed.error.issues[0]?.message ?? "Invalid reset request.",
      );
    }

    const { userId } = await consumeAuthToken(parsed.data.token, AuthTokenPurpose.PASSWORD_RESET);
    await prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS) },
    });

    // A password change must end every existing session: if the reset was
    // triggered because of a compromise, leaving old sessions alive defeats it.
    await revokeAllUserSessions(userId);

    res.json({
      success: true,
      data: { message: "Password updated. Please sign in." },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
