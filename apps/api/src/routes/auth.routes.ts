import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes, type RoleName } from "@nexaflow/shared";
import { signAccessToken, requireAuth, type RequestWithAuth } from "../middleware/auth";

// Authentication for the standalone GMB app.
//
// Deliberately small: login and /me. The monorepo's auth surface (2FA,
// invitations, password reset, impersonation, per-account login throttling)
// stays behind — none of it is needed to run GMB, and half-porting a security
// feature is worse than not having it.

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(ErrorCodes.VALIDATION_ERROR, 400, "Email and password are required.");
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { tenant: { select: { id: true, name: true, status: true } } },
    });

    // One message and one code for "no such user" and "wrong password" — a
    // distinguishable response would let anyone enumerate registered emails.
    const invalid = new ApiError(
      ErrorCodes.UNAUTHORIZED,
      401,
      "Invalid email or password.",
    );

    if (!user || !user.isActive) throw invalid;
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw invalid;

    if (user.tenant.status !== "ACTIVE") {
      throw new ApiError(ErrorCodes.FORBIDDEN, 403, "This workspace is not active.");
    }

    const accessToken = signAccessToken({
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role as RoleName,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    res.json({
      success: true,
      data: {
        accessToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          tenantName: user.tenant.name,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        tenant: { select: { name: true, industry: true, timezone: true } },
      },
    });
    if (!user) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "User not found.");
    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

export default router;
