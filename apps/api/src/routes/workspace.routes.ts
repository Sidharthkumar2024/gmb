import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { requireAuth, requireTenantScope, type RequestWithAuth } from "../middleware/auth";

// Workspace-level endpoints the app shell calls on every page load: language,
// currency, wallet balance and product access.
//
// This app ships one product, so `products/customer-access` reports Local SEO
// enabled rather than pretending to host a catalog. It exists because the
// shared AppShell asks for it; returning a truthful single-product answer is
// simpler and less misleading than porting the monorepo's entitlement system.

const router = Router();
router.use(requireAuth, requireTenantScope);

// --- language ---------------------------------------------------------------

const SUPPORTED_LANGUAGES = ["en", "hi", "mr", "ta", "te", "gu", "bn"];
const RTL_LANGUAGES = new Set(["ar", "he", "ur", "fa"]);

async function settingsFor(tenantId: string) {
  // Defaults are returned rather than written, so a fresh workspace needs no
  // migration backfill and reading never mutates.
  return (
    (await prisma.tenantSettings.findUnique({ where: { tenantId } })) ?? {
      tenantId,
      languageCode: "en",
      locale: "en-IN",
      currencyCode: "INR",
    }
  );
}

function languagePayload(s: { tenantId: string; languageCode: string; locale: string }) {
  return {
    setting: {
      tenantId: s.tenantId,
      languageCode: s.languageCode,
      locale: s.locale,
      direction: RTL_LANGUAGES.has(s.languageCode) ? ("RTL" as const) : ("LTR" as const),
      allowAutoTranslate: true,
      requireApprovalForSensitive: false,
      canUpdatePreference: true,
    },
    policy: {
      source: "platform" as const,
      defaultLanguageCode: "en",
      allowedLanguages: SUPPORTED_LANGUAGES,
      allowCustomerOverride: true,
    },
  };
}

router.get("/language-settings", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: languagePayload(await settingsFor(req.tenantId!)) });
  } catch (err) {
    next(err);
  }
});

const languagePatch = z.object({
  languageCode: z.string().min(2),
  locale: z.string().optional(),
});

router.patch("/language-settings", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const parsed = languagePatch.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(ErrorCodes.VALIDATION_ERROR, 400, "A languageCode is required.");
    }
    const { languageCode, locale } = parsed.data;
    if (!SUPPORTED_LANGUAGES.includes(languageCode)) {
      throw new ApiError(ErrorCodes.BAD_REQUEST, 400, `Language "${languageCode}" is not available.`);
    }

    const saved = await prisma.tenantSettings.upsert({
      where: { tenantId: req.tenantId! },
      update: { languageCode, ...(locale ? { locale } : {}) },
      create: { tenantId: req.tenantId!, languageCode, locale: locale ?? "en-IN" },
    });
    res.json({ success: true, data: languagePayload(saved) });
  } catch (err) {
    next(err);
  }
});

// --- currency ---------------------------------------------------------------

const CURRENCIES: Record<string, { symbol: string; minorUnit: number }> = {
  INR: { symbol: "₹", minorUnit: 2 },
  USD: { symbol: "$", minorUnit: 2 },
  EUR: { symbol: "€", minorUnit: 2 },
  GBP: { symbol: "£", minorUnit: 2 },
  AED: { symbol: "د.إ", minorUnit: 2 },
  AUD: { symbol: "A$", minorUnit: 2 },
  CAD: { symbol: "C$", minorUnit: 2 },
  SGD: { symbol: "S$", minorUnit: 2 },
};

function currencyPayload(s: { tenantId: string; currencyCode: string; locale: string }) {
  const meta = CURRENCIES[s.currencyCode] ?? CURRENCIES.INR;
  return {
    setting: {
      tenantId: s.tenantId,
      currencyCode: s.currencyCode,
      locale: s.locale,
      symbol: meta.symbol,
      minorUnit: meta.minorUnit,
      showConvertedAmounts: false,
      canUpdatePreference: true,
    },
    policy: {
      source: "platform" as const,
      defaultCurrencyCode: "INR",
      settlementCurrencyCode: "INR",
      allowedCurrencies: Object.keys(CURRENCIES),
      allowCustomerOverride: true,
    },
  };
}

router.get("/currency-settings", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: currencyPayload(await settingsFor(req.tenantId!)) });
  } catch (err) {
    next(err);
  }
});

const currencyPatch = z.object({
  currencyCode: z.string().min(3),
  locale: z.string().optional(),
});

router.patch("/currency-settings", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const parsed = currencyPatch.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(ErrorCodes.VALIDATION_ERROR, 400, "A currencyCode is required.");
    }
    const currencyCode = parsed.data.currencyCode.toUpperCase();
    if (!CURRENCIES[currencyCode]) {
      throw new ApiError(ErrorCodes.BAD_REQUEST, 400, `Currency "${currencyCode}" is not available.`);
    }

    const saved = await prisma.tenantSettings.upsert({
      where: { tenantId: req.tenantId! },
      update: { currencyCode, ...(parsed.data.locale ? { locale: parsed.data.locale } : {}) },
      create: {
        tenantId: req.tenantId!,
        currencyCode,
        locale: parsed.data.locale ?? "en-IN",
      },
    });
    res.json({ success: true, data: currencyPayload(saved) });
  } catch (err) {
    next(err);
  }
});

// --- wallet -----------------------------------------------------------------

router.get("/customer/wallets", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const wallets = await prisma.wallet.findMany({
      where: { tenantId: req.tenantId! },
      orderBy: { createdAt: "asc" },
    });
    res.json({
      success: true,
      data: {
        wallets: wallets.map((w) => ({
          id: w.id,
          status: w.status,
          balanceCredits: w.balanceCredits,
          reservedCredits: w.reservedCredits,
          availableCredits: w.balanceCredits - w.reservedCredits,
        })),
        primaryWallet: wallets[0]
          ? {
              id: wallets[0].id,
              balanceCredits: wallets[0].balanceCredits,
              reservedCredits: wallets[0].reservedCredits,
              availableCredits: wallets[0].balanceCredits - wallets[0].reservedCredits,
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// --- AI usage ----------------------------------------------------------------
// Read-only spend history for the billing page. AiUsage rows are written by the
// AI gateway after each call; this just reports them. No money moves here.

router.get("/customer/ai-usage", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.aiUsage.findMany({
      where: { tenantId: req.tenantId! },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Group by feature so the page can show "where the credits went" without
    // the client re-summing a hundred rows.
    const byFeature = new Map<string, { calls: number; costInCents: number }>();
    let totalCostInCents = 0;
    for (const r of rows) {
      totalCostInCents += r.costInCents;
      const cur = byFeature.get(r.feature) ?? { calls: 0, costInCents: 0 };
      cur.calls += 1;
      cur.costInCents += r.costInCents;
      byFeature.set(r.feature, cur);
    }

    res.json({
      success: true,
      data: {
        totalCalls: rows.length,
        totalCostInCents,
        byFeature: [...byFeature.entries()]
          .map(([feature, v]) => ({ feature, ...v }))
          .sort((a, b) => b.costInCents - a.costInCents),
        recent: rows.slice(0, 20).map((r) => ({
          id: r.id,
          feature: r.feature,
          model: r.model,
          costInCents: r.costInCents,
          createdAt: r.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// --- product access ---------------------------------------------------------

router.get("/products/customer-access", async (_req: RequestWithAuth, res: Response) => {
  // Single-product app: Local SEO is always on. Kept in the catalog shape the
  // shared AppShell expects so its nav gating works untouched.
  res.json({
    success: true,
    data: {
      products: [
        {
          key: "local_seo",
          name: "Local SEO (GMB)",
          enabled: true,
          source: "GLOBAL",
          addOns: [],
        },
      ],
      productsByKey: { local_seo: true },
      features: {},
      terminology: { public: "Customer", internal: "Workspace" },
    },
  });
});

export default router;
