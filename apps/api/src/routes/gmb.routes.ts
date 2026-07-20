import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import {
  prisma,
  GmbPostStatus,
  GmbPostType,
  GmbLocationStatus,
  GmbReviewStatus,
  GmbCitationStatus,
  GmbReportType,
  GmbDescriptionTarget,
  GmbDescriptionStatus,
  GmbImageStatus,
  GmbQuestionStatus,
  GmbPlaceActionType,
  GmbVerificationMethod,
} from "@nexaflow/db";
import { ApiError, ErrorCodes, Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  createPost,
  deletePost,
  draftGmbCaption,
  getPost,
  listPosts,
  schedulePost,
  updatePost,
} from "../services/gmb.service";
import { listNiches } from "../services/gmbNiche";
import { getBrandKit, saveBrandKit, PALETTE_PRESETS } from "../services/brandKit.service";
import { draftAutopilotPosts, approvePost, draftPendingReviewReplies } from "../services/gmbAutopilot.service";
import {
  getAutopilotConfig,
  saveAutopilotConfig,
} from "../services/gmbAutopilotScheduler.service";
import {
  createLocation,
  deleteLocation,
  getLocation,
  listLocations,
  updateLocation,
} from "../services/gmbLocation.service";
import {
  buildGoogleReviewLink,
  buildReviewRequestText,
  deleteReview,
  generateReplyDraft,
  getReputationSummary,
  getReview,
  ingestReview,
  listReviews,
  replyToReview,
  updateReviewStatus,
} from "../services/gmbReview.service";
import {
  addKeyword,
  deleteKeyword,
  getKeywordWithTrend,
  listKeywords,
  listSnapshots,
  recordSnapshot,
  setKeywordActive,
} from "../services/gmbRanking.service";
import {
  deleteInsight,
  getInsightsSummary,
  listInsights,
  recordInsight,
} from "../services/gmbInsights.service";
import {
  createCitation,
  deleteCitation,
  getCitation,
  getCitationSummary,
  listCitations,
  scanCitations,
  updateCitation,
} from "../services/gmbCitation.service";
import { recommendedDirectories } from "../services/gmbCitationScan";
import {
  clusterKeywordIdeas,
  createIdeaSet,
  deleteIdeaSet,
  draftKeywordIdeasWithAi,
  getIdeaSet,
  listIdeaSets,
} from "../services/gmbKeyword.service";
import {
  createDescription,
  deleteDescription,
  getDescription,
  listDescriptions,
  optimizeDescriptionWithAi,
  updateDescription,
} from "../services/gmbDescription.service";
import {
  deleteAdvice,
  generateAdvice,
  getAdvice,
  listAdvice,
} from "../services/gmbAdvisor.service";
import {
  buildImagePrompt,
  createImageRequest,
  deleteImageRequest,
  getImageRequest,
  listImageRequests,
  processImageRequest,
  updateImageRequest,
} from "../services/gmbImage.service";
import { getDashboard } from "../services/gmbDashboard.service";
import { publishDuePosts } from "../services/gmbScheduler.service";
import { listSyncStatus, syncLocation } from "../services/gmbSync.service";
import {
  captureGridSnapshot,
  getLatestGridSnapshot,
} from "../services/gmbGridRank.service";
import {
  createRankAlertRule,
  deleteRankAlertRule,
  listRankAlertRules,
  updateRankAlertRule,
} from "../services/gmbRankAlert.service";
import {
  answerQuestion,
  deleteQuestion,
  generateAnswerDraft,
  getQuestion,
  ingestQuestion,
  listQuestions,
  summarizeQuestions,
  updateQuestionStatus,
} from "../services/gmbQuestion.service";
import {
  deletePlaceAction,
  listPlaceActions,
  setPlaceActionActive,
  suggestPlaceActions,
  upsertPlaceAction,
} from "../services/gmbPlaceAction.service";
import {
  cancelVerification,
  completeVerification,
  getVerificationStatus,
  requestVerification,
} from "../services/gmbVerification.service";
import {
  buildGoogleBusinessProfileOAuthUrl,
  disconnectGoogleBusinessProfile,
  exchangeGoogleOAuthCode,
  getGoogleConnectionStatus,
  saveManualGoogleRefreshToken,
  signGoogleOAuthState,
  syncGoogleLocations,
  verifyGoogleOAuthState,
} from "../services/gmbGoogle.service";
import {
  deleteReport,
  generateReport,
  buildReportWhatsAppText,
  getReport,
  listReports,
  resolveReportIssuer,
} from "../services/gmbReport.service";
import { renderGmbReportPdf } from "../services/gmbReportPdf.service";
import { checkGmbSchema } from "../services/gmbHealth.service";
import { listGmbAiCosts } from "../services/billing.service";
import { getReportSchedule, setReportSchedule } from "../services/gmbReportScheduler.service";
import { decryptTokenIfNeeded } from "../lib/tokenCrypto";

// GMB AI Manager routes (Complete Planning PDF §2.19). Tenant-scoped post
// drafting + scheduling, gated by GMB_MANAGE. Mutations audited.
//
// Also gated on the `local_seo` product entitlement, so Local SEO can be sold
// as its own SKU: SuperAdmin can disable it globally or per customer, and a
// partner's customer only gets it when the partner has been granted it.
// RBAC answers "may this user?"; the product answers "was this sold?" — both
// must pass.

const router = Router();
router.use(
  requireAuth,
  requireTenantScope,
  requirePermission(Permissions.GMB_MANAGE),
);

// Schema self-check: probes every GMB table so un-applied migrations (DB behind
// the shipped Prisma client) surface as a clear per-table report instead of
// generic 500s elsewhere. 200 with ok:false when any table is unreachable.
router.get("/health", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await checkGmbSchema() });
  } catch (err) {
    next(err);
  }
});

// Per-action AI credit costs, so the customer UI can show "costs N credits"
// before running an AI feature. Reflects the live Credit Engine pricing.
router.get("/credit-costs", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listGmbAiCosts() });
  } catch (err) {
    next(err);
  }
});

const ctaEnum = z.enum(["LEARN_MORE", "CALL", "ORDER", "BOOK", "SIGN_UP", "SHOP"]);

const listSchema = z.object({ status: z.nativeEnum(GmbPostStatus).optional() });

const createSchema = z.object({
  type: z.nativeEnum(GmbPostType).optional(),
  summary: z.string().trim().min(1).max(1500),
  mediaUrl: z.string().url().max(500).optional(),
  callToActionType: ctaEnum.optional(),
  callToActionUrl: z.string().url().max(500).optional(),
  locationLabel: z.string().trim().max(160).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const generateSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  type: z.nativeEnum(GmbPostType).optional(),
  topic: z.string().trim().max(300).optional(),
  // Unified to two tones; legacy values are normalized server-side.
  tone: z.enum(["professional", "friendly", "warm", "playful"]).optional(),
  niche: z.string().trim().max(40).optional(),
  locationLabel: z.string().trim().max(160).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const updateSchema = z
  .object({
    type: z.nativeEnum(GmbPostType).optional(),
    summary: z.string().trim().min(1).max(1500).optional(),
    mediaUrl: z.string().url().max(500).nullable().optional(),
    callToActionType: ctaEnum.nullable().optional(),
    callToActionUrl: z.string().url().max(500).nullable().optional(),
    locationLabel: z.string().trim().max(160).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

const scheduleSchema = z.object({ scheduledAt: z.string().datetime() });

router.get("/posts", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { status } = listSchema.parse(req.query);
    res.json({ success: true, data: await listPosts(req.tenantId!, status) });
  } catch (err) {
    next(err);
  }
});

router.post("/posts", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const post = await createPost(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbPost",
      resourceId: post.id,
      newValues: { type: post.type, status: post.status },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

// Niche catalog for the post-composer picker (industry-specific templates).
router.get("/posts/niches", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: listNiches() });
  } catch (err) {
    next(err);
  }
});

// Brand kit (logo / phone / website / colors) used to compose branded post designs.
router.get("/brand-kit", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getBrandKit(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

router.get("/brand-kit/palettes", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: PALETTE_PRESETS });
  } catch (err) {
    next(err);
  }
});

const brandKitSchema = z.object({
  logoUrl: z.string().url().max(500).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  website: z.string().url().max(500).nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

router.put("/brand-kit", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = brandKitSchema.parse(req.body);
    const kit = await saveBrandKit(req.tenantId!, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "BrandKit",
      resourceId: req.tenantId!,
      newValues: { fields: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: kit });
  } catch (err) {
    next(err);
  }
});

// Scheduled autopilot config (opt-in cron that auto-drafts on a cadence).
router.get("/autopilot", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getAutopilotConfig(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

const autopilotConfigSchema = z.object({
  enabled: z.boolean(),
  businessName: z.string().trim().min(1).max(120),
  niche: z.string().trim().max(40).optional(),
  tone: z.enum(["professional", "friendly"]).optional(),
  postsPerRun: z.number().int().min(1).max(14).optional(),
  cadenceHours: z.number().int().min(1).max(720).optional(),
  autoDraftReplies: z.boolean().optional(),
  replyTone: z.enum(["warm", "professional"]).optional(),
});

router.put("/autopilot", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = autopilotConfigSchema.parse(req.body);
    const cfg = await saveAutopilotConfig(req.tenantId!, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbAutopilotConfig",
      resourceId: req.tenantId!,
      newValues: { enabled: cfg.enabled, cadenceHours: cfg.cadenceHours },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: cfg });
  } catch (err) {
    next(err);
  }
});

// Manual "run autopilot now" — runs one sweep pass immediately (drafts due work
// for THIS tenant only, regardless of cadence, by forcing a run).
router.post("/autopilot/run", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const cfg = await getAutopilotConfig(req.tenantId!);
    if (!cfg.enabled) {
      const posts = await draftAutopilotPosts(req.tenantId!, {
        businessName: cfg.businessName || "our business",
        niche: cfg.niche,
        tone: cfg.tone,
        count: cfg.postsPerRun,
        createdByUserId: req.userId,
      });
      res.json({ success: true, data: { postsDrafted: posts.length, repliesDrafted: 0, note: "autopilot not enabled — drafted a one-off batch" } });
      return;
    }
    // Enabled: force this tenant's due work through the shared sweep by clearing
    // its lastRunAt is overkill; just draft directly for immediate feedback.
    const posts = await draftAutopilotPosts(req.tenantId!, {
      businessName: cfg.businessName,
      niche: cfg.niche,
      tone: cfg.tone,
      count: cfg.postsPerRun,
      createdByUserId: req.userId,
    });
    let repliesDrafted = 0;
    if (cfg.autoDraftReplies) {
      const r = await draftPendingReviewReplies(req.tenantId!, {
        tone: cfg.replyTone === "professional" ? "professional" : "warm",
      });
      repliesDrafted = r.drafted;
    }
    res.json({ success: true, data: { postsDrafted: posts.length, repliesDrafted } });
  } catch (err) {
    next(err);
  }
});

// Autopilot: draft a batch of posts into the PENDING_APPROVAL queue.
const autopilotSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  niche: z.string().trim().max(40).optional(),
  tone: z.enum(["professional", "friendly", "warm", "playful"]).optional(),
  count: z.number().int().min(1).max(14).optional(),
  topics: z.array(z.string().trim().max(300)).max(14).optional(),
});

router.post("/posts/autopilot", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = autopilotSchema.parse(req.body);
    const posts = await draftAutopilotPosts(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbPost",
      resourceId: posts[0]?.id ?? "batch",
      newValues: { autopilot: true, drafted: posts.length },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: posts });
  } catch (err) {
    next(err);
  }
});

// Approve a pending/draft post → SCHEDULED (with a time) or DRAFT.
const approveSchema = z.object({ scheduledAt: z.string().datetime().nullable().optional() });

router.post("/posts/:id/approve", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { scheduledAt } = approveSchema.parse(req.body ?? {});
    const post = await approvePost(req.tenantId!, req.params.id, { scheduledAt });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbPost",
      resourceId: post.id,
      newValues: { approved: true, status: post.status },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

// AI caption generator → creates a draft (or scheduled) post.
router.post("/posts/generate", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = generateSchema.parse(req.body);
    const caption = await draftGmbCaption(req.tenantId!, body);
    const post = await createPost(req.tenantId!, {
      type: caption.type,
      summary: caption.summary,
      callToActionType: caption.callToActionType,
      locationLabel: body.locationLabel,
      scheduledAt: body.scheduledAt,
      createdByUserId: req.userId,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbPost",
      resourceId: post.id,
      newValues: { generated: true, type: post.type, source: caption.source },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

router.get("/posts/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getPost(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/posts/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const post = await updatePost(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbPost",
      resourceId: post.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

router.post("/posts/:id/schedule", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { scheduledAt } = scheduleSchema.parse(req.body);
    const post = await schedulePost(req.tenantId!, req.params.id, scheduledAt);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbPost",
      resourceId: post.id,
      newValues: { scheduled: true },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

router.delete("/posts/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deletePost(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbPost",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- Google Business Profile connection (AdGrowly GMB-first) ---------------

const oauthUrlSchema = z.object({
  redirectUri: z.string().url().max(800),
});

const oauthExchangeSchema = z.object({
  code: z.string().trim().min(1).max(5000),
  redirectUri: z.string().url().max(800),
  state: z.string().trim().max(2000).optional(),
  label: z.string().trim().min(1).max(120).optional(),
});

const manualGoogleTokenSchema = z.object({
  refreshToken: z.string().trim().min(1).max(20_000),
  accessToken: z.string().trim().max(20_000).optional(),
  expiresIn: z.number().int().min(60).max(31_536_000).optional(),
  scope: z.string().trim().max(1000).optional(),
  accountName: z.string().trim().max(240).optional(),
  label: z.string().trim().min(1).max(120).optional(),
});

const googleLocationSyncSchema = z.object({
  secretId: z.string().cuid().optional(),
});

router.get("/google/connection", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getGoogleConnectionStatus(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

router.get("/google/oauth-url", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { redirectUri } = oauthUrlSchema.parse(req.query);
    const state = signGoogleOAuthState({
      tenantId: req.tenantId!,
      userId: req.userId!,
      iat: Date.now(),
      nonce: Math.random().toString(36).slice(2),
    });
    res.json({
      success: true,
      data: {
        authorizationUrl: buildGoogleBusinessProfileOAuthUrl({ redirectUri, state }),
        state,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/google/oauth/exchange", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = oauthExchangeSchema.parse(req.body);
    if (body.state) {
      const state = verifyGoogleOAuthState(body.state);
      if (state.tenantId !== req.tenantId! || state.userId !== req.userId!) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "Google OAuth state does not match the current session.",
        );
      }
    }
    const secret = await exchangeGoogleOAuthCode({
      tenantId: req.tenantId!,
      code: body.code,
      redirectUri: body.redirectUri,
      label: body.label,
      createdByUserId: req.userId,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GoogleBusinessProfileConnection",
      resourceId: secret.id,
      newValues: { connected: true, scopes: secret.scopes },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: secret });
  } catch (err) {
    next(err);
  }
});

router.post("/google/manual-token", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = manualGoogleTokenSchema.parse(req.body);
    const secret = await saveManualGoogleRefreshToken({
      tenantId: req.tenantId!,
      ...body,
      createdByUserId: req.userId,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GoogleBusinessProfileConnection",
      resourceId: secret.id,
      newValues: { manualTokenSaved: true, scopes: secret.scopes },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: secret });
  } catch (err) {
    next(err);
  }
});

router.post("/google/disconnect", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const result = await disconnectGoogleBusinessProfile(req.tenantId!);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GoogleBusinessProfileConnection",
      newValues: result,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/google/sync-locations", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = googleLocationSyncSchema.parse(req.body ?? {});
    const result = await syncGoogleLocations({
      tenantId: req.tenantId!,
      secretId: body.secretId,
      createdByUserId: req.userId,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbLocation",
      newValues: { googleSyncLocations: result },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// --- Business Profile / locations (AdGrowly GMB-first) ---------------------


const locationListSchema = z.object({ status: z.nativeEnum(GmbLocationStatus).optional() });

const createLocationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  storeCode: z.string().trim().max(60).optional(),
  placeId: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  website: z.string().url().max(300).optional(),
  primaryCategory: z.string().trim().max(120).optional(),
  addressLine: z.string().trim().max(240).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().max(60).optional(),
  secretId: z.string().cuid().nullable().optional(),
});

const updateLocationSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    storeCode: z.string().trim().max(60).nullable().optional(),
    placeId: z.string().trim().max(120).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    website: z.string().url().max(300).nullable().optional(),
    primaryCategory: z.string().trim().max(120).nullable().optional(),
    addressLine: z.string().trim().max(240).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    region: z.string().trim().max(120).nullable().optional(),
    postalCode: z.string().trim().max(20).nullable().optional(),
    country: z.string().trim().max(60).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    secretId: z.string().cuid().nullable().optional(),
    status: z.nativeEnum(GmbLocationStatus).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

router.get("/locations", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { status } = locationListSchema.parse(req.query);
    res.json({ success: true, data: await listLocations(req.tenantId!, status) });
  } catch (err) {
    next(err);
  }
});

router.post("/locations", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createLocationSchema.parse(req.body);
    const location = await createLocation(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbLocation",
      resourceId: location.id,
      newValues: { name: location.name, status: location.status },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
});

router.get("/locations/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getLocation(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/locations/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateLocationSchema.parse(req.body);
    const location = await updateLocation(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbLocation",
      resourceId: location.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
});

router.delete("/locations/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteLocation(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbLocation",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- Reputation / reviews (AdGrowly GMB-first) -----------------------------

const reviewListSchema = z.object({
  locationId: z.string().cuid().optional(),
  status: z.nativeEnum(GmbReviewStatus).optional(),
});

const summarySchema = z.object({ locationId: z.string().cuid().optional() });

const ingestReviewSchema = z.object({
  locationId: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  authorName: z.string().trim().max(160).optional(),
  comment: z.string().trim().max(4000).optional(),
  reviewedAt: z.string().datetime().optional(),
  externalReviewId: z.string().trim().max(200).optional(),
});

const draftReplySchema = z.object({
  tone: z.enum(["warm", "professional"]).optional(),
});

const replySchema = z.object({ text: z.string().trim().min(1).max(1500) });

const reviewStatusSchema = z.object({ status: z.nativeEnum(GmbReviewStatus) });

router.get("/reviews", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const filter = reviewListSchema.parse(req.query);
    res.json({ success: true, data: await listReviews(req.tenantId!, filter) });
  } catch (err) {
    next(err);
  }
});

router.get("/reviews/summary", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { locationId } = summarySchema.parse(req.query);
    res.json({ success: true, data: await getReputationSummary(req.tenantId!, locationId) });
  } catch (err) {
    next(err);
  }
});

router.post("/reviews", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = ingestReviewSchema.parse(req.body);
    const review = await ingestReview(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbReview",
      resourceId: review.id,
      newValues: { locationId: review.locationId, rating: review.rating },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
});

// Build an AI-assisted reply draft (not saved/published).
router.post("/reviews/:id/draft-reply", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { tone } = draftReplySchema.parse(req.body ?? {});
    res.json({ success: true, data: await generateReplyDraft(req.tenantId!, req.params.id, tone) });
  } catch (err) {
    next(err);
  }
});

// Auto-draft replies for all un-answered reviews (they stay NEW = awaiting
// approval; the operator then publishes each via /reviews/:id/reply).
const autoDraftSchema = z.object({
  locationId: z.string().cuid().optional(),
  tone: z.enum(["warm", "professional"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

router.post("/reviews/auto-draft", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = autoDraftSchema.parse(req.body ?? {});
    const result = await draftPendingReviewReplies(req.tenantId!, body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Approve + record a reply. Google-synced reviews publish to Business Profile;
// manually logged reviews remain local-only.
router.post("/reviews/:id/reply", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { text } = replySchema.parse(req.body);
    const review = await replyToReview(req.tenantId!, req.params.id, text);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "REPLY",
      resource: "GmbReview",
      resourceId: review.id,
      newValues: { publishedToGoogle: review.publishedToGoogle },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
});

router.get("/reviews/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getReview(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/reviews/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { status } = reviewStatusSchema.parse(req.body);
    const review = await updateReviewStatus(req.tenantId!, req.params.id, status);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbReview",
      resourceId: review.id,
      newValues: { status },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
});

router.delete("/reviews/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteReview(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbReview",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- Local ranking tracker (AdGrowly GMB-first) ----------------------------

const keywordListSchema = z.object({
  locationId: z.string().cuid().optional(),
  activeOnly: z.coerce.boolean().optional(),
});

const addKeywordSchema = z.object({
  locationId: z.string().cuid(),
  keyword: z.string().trim().min(1).max(160),
});

const keywordActiveSchema = z.object({ isActive: z.boolean() });

const snapshotSchema = z.object({
  rank: z.number().int().min(1).max(1000).nullable().optional(),
  source: z.string().trim().max(80).optional(),
  checkedAt: z.string().datetime().optional(),
});

const snapshotListSchema = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

router.get("/keywords", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const filter = keywordListSchema.parse(req.query);
    res.json({ success: true, data: await listKeywords(req.tenantId!, filter) });
  } catch (err) {
    next(err);
  }
});

router.post("/keywords", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = addKeywordSchema.parse(req.body);
    const keyword = await addKeyword(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbTrackedKeyword",
      resourceId: keyword.id,
      newValues: { locationId: keyword.locationId, keyword: keyword.keyword },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: keyword });
  } catch (err) {
    next(err);
  }
});

router.get("/keywords/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getKeywordWithTrend(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/keywords/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { isActive } = keywordActiveSchema.parse(req.body);
    const keyword = await setKeywordActive(req.tenantId!, req.params.id, isActive);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbTrackedKeyword",
      resourceId: keyword.id,
      newValues: { isActive },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: keyword });
  } catch (err) {
    next(err);
  }
});

router.delete("/keywords/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteKeyword(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbTrackedKeyword",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

router.get("/keywords/:id/snapshots", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { limit } = snapshotListSchema.parse(req.query);
    res.json({ success: true, data: await listSnapshots(req.tenantId!, req.params.id, limit) });
  } catch (err) {
    next(err);
  }
});

// Record a rank check (rank null = not found in window). Live grid/SERP
// capture posts here in a later slice.
router.post("/keywords/:id/snapshots", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = snapshotSchema.parse(req.body);
    const snapshot = await recordSnapshot(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbRankSnapshot",
      resourceId: snapshot.id,
      newValues: { keywordId: snapshot.keywordId, rank: snapshot.rank },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: snapshot });
  } catch (err) {
    next(err);
  }
});

// --- Grid rank tracker (Adgrowly GMB Panel design) --------------------------

const gridCaptureSchema = z.object({
  gridSize: z.number().int().min(3).max(7).optional(),
  radiusKm: z.number().min(0.5).max(10).optional(),
});

// Latest grid snapshot for the heat-map UI. Null when never captured.
router.get(
  "/keywords/:id/grid-snapshots/latest",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      res.json({
        success: true,
        data: await getLatestGridSnapshot(req.tenantId!, req.params.id),
      });
    } catch (err) {
      next(err);
    }
  },
);

// Capture a fresh grid: N×N Places searches around the location.
router.post(
  "/keywords/:id/grid-snapshots",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = gridCaptureSchema.parse(req.body ?? {});
      const result = await captureGridSnapshot({
        tenantId: req.tenantId!,
        keywordId: req.params.id,
        gridSize: body.gridSize,
        radiusKm: body.radiusKm,
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "GmbRankGridSnapshot",
        resourceId: result.snapshotId,
        newValues: {
          keywordId: req.params.id,
          gridSize: result.gridSize,
          avgRank: result.stats.avgRank,
          top3Share: result.stats.top3Share,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// --- Rank-drop alert rules (Adgrowly GMB Panel design — "Create alert rule") --
// A rule fires when its keyword's newest rank crosses from OK (<= threshold)
// to BAD (worse, or not found). Evaluation happens on the snapshot write
// paths; these routes are pure tenant-scoped CRUD.

const rankAlertCreateSchema = z.object({
  keywordId: z.string().cuid(),
  thresholdRank: z.number().int().min(1).max(100),
  notifyEmail: z.string().trim().email().max(254).nullable().optional(),
});

const rankAlertUpdateSchema = z.object({
  thresholdRank: z.number().int().min(1).max(100).optional(),
  notifyEmail: z.string().trim().email().max(254).nullable().optional(),
  isActive: z.boolean().optional(),
});

router.get("/rank-alerts", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listRankAlertRules(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

router.post("/rank-alerts", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = rankAlertCreateSchema.parse(req.body);
    const rule = await createRankAlertRule(req.tenantId!, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbRankAlertRule",
      resourceId: rule.id,
      newValues: {
        keywordId: rule.keywordId,
        thresholdRank: rule.thresholdRank,
        hasEmail: Boolean(rule.notifyEmail),
      },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: rule });
  } catch (err) {
    next(err);
  }
});

router.patch("/rank-alerts/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = rankAlertUpdateSchema.parse(req.body);
    const rule = await updateRankAlertRule(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbRankAlertRule",
      resourceId: rule.id,
      newValues: {
        thresholdRank: rule.thresholdRank,
        isActive: rule.isActive,
        hasEmail: Boolean(rule.notifyEmail),
      },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: rule });
  } catch (err) {
    next(err);
  }
});

router.delete("/rank-alerts/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteRankAlertRule(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbRankAlertRule",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- GBP Q&A (Adgrowly GMB Panel — "Q&A API") ------------------------------
// Mirrors the reviews pipeline: sync/log a question → AI draft → approve →
// answer. Answers are approval-first (never auto-posted), matching Google's
// automated-change policy and the review-reply default.

const questionListSchema = z.object({
  locationId: z.string().cuid().optional(),
  status: z.nativeEnum(GmbQuestionStatus).optional(),
});
const ingestQuestionSchema = z.object({
  locationId: z.string().cuid(),
  questionText: z.string().trim().min(1).max(2000),
  authorName: z.string().trim().max(160).optional(),
  askedAt: z.string().datetime().optional(),
  externalQuestionId: z.string().trim().max(200).optional(),
});
const answerSchema = z.object({ text: z.string().trim().min(1).max(1000) });
const questionStatusSchema = z.object({ status: z.nativeEnum(GmbQuestionStatus) });

router.get("/questions", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const filter = questionListSchema.parse(req.query);
    res.json({ success: true, data: await listQuestions(req.tenantId!, filter) });
  } catch (err) {
    next(err);
  }
});

router.get("/questions/summary", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { locationId } = questionListSchema.parse(req.query);
    res.json({ success: true, data: await summarizeQuestions(req.tenantId!, locationId) });
  } catch (err) {
    next(err);
  }
});

router.post("/questions", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = ingestQuestionSchema.parse(req.body);
    const question = await ingestQuestion(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbQuestion",
      resourceId: question.id,
      newValues: { locationId: question.locationId },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: question });
  } catch (err) {
    next(err);
  }
});

// Build an AI-assisted answer draft (not saved/posted).
router.post("/questions/:id/draft-answer", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await generateAnswerDraft(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.post("/questions/:id/answer", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { text } = answerSchema.parse(req.body);
    const question = await answerQuestion(req.tenantId!, req.params.id, text);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "ANSWER",
      resource: "GmbQuestion",
      resourceId: question.id,
      newValues: { publishedToGoogle: question.publishedToGoogle },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: question });
  } catch (err) {
    next(err);
  }
});

router.get("/questions/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getQuestion(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/questions/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { status } = questionStatusSchema.parse(req.body);
    const question = await updateQuestionStatus(req.tenantId!, req.params.id, status);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbQuestion",
      resourceId: question.id,
      newValues: { status },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: question });
  } catch (err) {
    next(err);
  }
});

router.delete("/questions/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteQuestion(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbQuestion",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- GBP Place Actions (Adgrowly GMB Panel — "Place Actions API") ----------
// Booking/appointment/order links on the profile, pre-fillable from the
// tenant's own /book/<tenantId> page. Google write gated on a live connection.

const placeActionListSchema = z.object({ locationId: z.string().cuid().optional() });
const placeActionUpsertSchema = z.object({
  locationId: z.string().cuid(),
  actionType: z.nativeEnum(GmbPlaceActionType),
  url: z.string().trim().url().max(600),
});
const placeActionToggleSchema = z.object({ isActive: z.boolean() });

router.get("/place-actions", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { locationId } = placeActionListSchema.parse(req.query);
    res.json({ success: true, data: await listPlaceActions(req.tenantId!, locationId) });
  } catch (err) {
    next(err);
  }
});

// Suggested links (not saved) pre-filled from the tenant's booking page.
router.get("/place-actions/suggest", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const locationId = z.string().cuid().parse(req.query.locationId);
    res.json({ success: true, data: await suggestPlaceActions(req.tenantId!, locationId) });
  } catch (err) {
    next(err);
  }
});

router.put("/place-actions", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = placeActionUpsertSchema.parse(req.body);
    const action = await upsertPlaceAction(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbPlaceAction",
      resourceId: action.id,
      newValues: { actionType: action.actionType, locationId: action.locationId },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: action });
  } catch (err) {
    next(err);
  }
});

router.patch("/place-actions/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { isActive } = placeActionToggleSchema.parse(req.body);
    const action = await setPlaceActionActive(req.tenantId!, req.params.id, isActive);
    res.json({ success: true, data: action });
  } catch (err) {
    next(err);
  }
});

router.delete("/place-actions/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deletePlaceAction(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbPlaceAction",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- GBP Verifications (Adgrowly GMB Panel — "Verifications API") -----------
// CRITICAL: verification is only ever started by the owner's explicit request
// (req.userId is the customer-initiated enforcement point) — never background.

const verificationStatusSchema = z.object({ locationId: z.string().cuid() });
const verificationRequestSchema = z.object({
  locationId: z.string().cuid(),
  method: z.nativeEnum(GmbVerificationMethod),
});
const verificationCompleteSchema = z.object({ code: z.string().trim().min(1).max(32) });

router.get("/verifications/status", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { locationId } = verificationStatusSchema.parse(req.query);
    res.json({ success: true, data: await getVerificationStatus(req.tenantId!, locationId) });
  } catch (err) {
    next(err);
  }
});

router.post("/verifications", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = verificationRequestSchema.parse(req.body);
    // req.userId is REQUIRED downstream — the customer-initiated guarantee.
    const request = await requestVerification({
      tenantId: req.tenantId!,
      locationId: body.locationId,
      method: body.method,
      requestedByUserId: req.userId!,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbVerificationRequest",
      resourceId: request.id,
      newValues: { locationId: body.locationId, method: body.method },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
});

router.post("/verifications/:id/complete", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { code } = verificationCompleteSchema.parse(req.body);
    const request = await completeVerification({
      tenantId: req.tenantId!,
      requestId: req.params.id,
      code,
    });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbVerificationRequest",
      resourceId: request.id,
      newValues: { state: request.state },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
});

router.post("/verifications/:id/cancel", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const request = await cancelVerification(req.tenantId!, req.params.id);
    res.json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
});

// --- Insights / performance snapshots (AdGrowly GMB-first) -----------------

const insightFilterSchema = z.object({
  locationId: z.string().cuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const metricCount = z.number().int().min(0).max(100_000_000).optional();

const recordInsightSchema = z.object({
  locationId: z.string().cuid(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  source: z.string().trim().max(80).optional(),
  mapsViews: metricCount,
  searchViews: metricCount,
  directSearches: metricCount,
  discoverySearches: metricCount,
  brandedSearches: metricCount,
  callClicks: metricCount,
  websiteClicks: metricCount,
  directionRequests: metricCount,
  messageClicks: metricCount,
  bookingClicks: metricCount,
  photoViews: metricCount,
});

router.get("/insights", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const filter = insightFilterSchema.parse(req.query);
    res.json({ success: true, data: await listInsights(req.tenantId!, filter) });
  } catch (err) {
    next(err);
  }
});

router.get("/insights/summary", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const filter = insightFilterSchema.parse(req.query);
    res.json({ success: true, data: await getInsightsSummary(req.tenantId!, filter) });
  } catch (err) {
    next(err);
  }
});

// Record (or re-sync) a period snapshot. Upserts on location+period.
router.post("/insights", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = recordInsightSchema.parse(req.body);
    const insight = await recordInsight(req.tenantId!, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbInsightSnapshot",
      resourceId: insight.id,
      newValues: { locationId: insight.locationId, periodStart: insight.periodStart },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: insight });
  } catch (err) {
    next(err);
  }
});

router.delete("/insights/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteInsight(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbInsightSnapshot",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- Citations / NAP consistency (AdGrowly GMB-first) ----------------------

const citationListSchema = z.object({
  locationId: z.string().cuid().optional(),
  status: z.nativeEnum(GmbCitationStatus).optional(),
});

const citationSummarySchema = z.object({ locationId: z.string().cuid().optional() });

const createCitationSchema = z.object({
  locationId: z.string().cuid(),
  directory: z.string().trim().min(1).max(120),
  listingUrl: z.string().url().max(500).optional(),
  napName: z.string().trim().max(200).optional(),
  napAddress: z.string().trim().max(400).optional(),
  napPhone: z.string().trim().max(60).optional(),
  status: z.nativeEnum(GmbCitationStatus).optional(),
});

const updateCitationSchema = z
  .object({
    listingUrl: z.string().url().max(500).nullable().optional(),
    napName: z.string().trim().max(200).nullable().optional(),
    napAddress: z.string().trim().max(400).nullable().optional(),
    napPhone: z.string().trim().max(60).nullable().optional(),
    status: z.nativeEnum(GmbCitationStatus).optional(),
    markChecked: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

router.get("/citations", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const filter = citationListSchema.parse(req.query);
    res.json({ success: true, data: await listCitations(req.tenantId!, filter) });
  } catch (err) {
    next(err);
  }
});

router.get("/citations/summary", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { locationId } = citationSummarySchema.parse(req.query);
    res.json({ success: true, data: await getCitationSummary(req.tenantId!, locationId) });
  } catch (err) {
    next(err);
  }
});

// Recommended directories for a niche (the citation to-do checklist).
router.get("/citations/recommended", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const niche = typeof req.query.niche === "string" ? req.query.niche : undefined;
    res.json({ success: true, data: recommendedDirectories(niche) });
  } catch (err) {
    next(err);
  }
});

// Scan a location's citations for NAP inconsistencies + missing directories.
const citationScanSchema = z.object({
  locationId: z.string().cuid(),
  niche: z.string().trim().max(40).optional(),
});

router.post("/citations/scan", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { locationId, niche } = citationScanSchema.parse(req.body);
    res.json({ success: true, data: await scanCitations(req.tenantId!, locationId, niche) });
  } catch (err) {
    next(err);
  }
});

router.post("/citations", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createCitationSchema.parse(req.body);
    const citation = await createCitation(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbCitation",
      resourceId: citation.id,
      newValues: { locationId: citation.locationId, directory: citation.directory },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: citation });
  } catch (err) {
    next(err);
  }
});

router.get("/citations/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getCitation(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/citations/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateCitationSchema.parse(req.body);
    const citation = await updateCitation(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbCitation",
      resourceId: citation.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: citation });
  } catch (err) {
    next(err);
  }
});

router.delete("/citations/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteCitation(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbCitation",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- Reports / AI monthly report (AdGrowly GMB-first) ----------------------

const reportListSchema = z.object({
  locationId: z.string().cuid().optional(),
  type: z.nativeEnum(GmbReportType).optional(),
});

const generateReportSchema = z.object({
  locationId: z.string().cuid().optional(),
  type: z.nativeEnum(GmbReportType).optional(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});

router.get("/reports", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const filter = reportListSchema.parse(req.query);
    res.json({ success: true, data: await listReports(req.tenantId!, filter) });
  } catch (err) {
    next(err);
  }
});

// Aggregate reputation/insights/ranking/citations/posts into a stored report
// with a narrative summary and an action plan.
router.post("/reports/generate", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = generateReportSchema.parse(req.body);
    const report = await generateReport(req.tenantId!, { ...body, generatedByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbReport",
      resourceId: report.id,
      newValues: { type: report.type, locationId: report.locationId },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

router.get("/reports/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getReport(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

// Download a report as PDF (planning PDF §3: "Download PDF reports").
router.get("/reports/:id/pdf", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const report = await getReport(req.tenantId!, req.params.id);
    const buffer = await renderGmbReportPdf({ report, issuerName: await resolveReportIssuer(req.tenantId!) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="gmb-report-${report.id}.pdf"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

const shareReportSchema = z.object({
  to: z.string().trim().regex(/^\+?[1-9]\d{6,14}$/, "Enter a valid WhatsApp number (E.164)."),
});

// Share a report summary over WhatsApp (planning PDF §6 hook: "WhatsApp
// report sharing"). Full compliant send path: afford + throttle gates,
// recorded + debited like any outbound message.
// The monorepo had two WhatsApp cross-sell endpoints here:
//   POST /reports/:id/share-whatsapp  and  POST /review-request
// Both are removed in the standalone app — they were the only place GMB
// touched the WhatsApp product, and reimplementing them would mean pulling in
// a BSP integration, send throttling and message billing. Re-add them against
// email/SMS, or as calls back to the WhatsApp product API, if the cross-sell
// is wanted.
router.delete("/reports/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteReport(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbReport",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- AI Keyword Finder (AdGrowly GMB-first, Phase 2) ------------------------

const keywordInputShape = {
  category: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  services: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  competitors: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  seedKeywords: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
  limit: z.number().int().min(1).max(200).optional(),
};

const generateIdeasSchema = z.object(keywordInputShape);
const createIdeaSetSchema = z.object({ ...keywordInputShape, locationId: z.string().cuid().optional() });
const ideaSetListSchema = z.object({ locationId: z.string().cuid().optional() });

// Preview keyword ideas without saving — LLM-backed via the admin's
// gmb.keyword_finder prompt, deterministic fallback on any failure.
router.post("/keyword-ideas/generate", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = generateIdeasSchema.parse(req.body ?? {});
    const { ideas, source } = await draftKeywordIdeasWithAi(req.tenantId!, input);
    res.json({ success: true, data: { ideas, clusters: clusterKeywordIdeas(ideas), source } });
  } catch (err) {
    next(err);
  }
});

router.post("/keyword-ideas", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createIdeaSetSchema.parse(req.body);
    const set = await createIdeaSet(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbKeywordIdeaSet",
      resourceId: set.id,
      newValues: { count: set.count, city: set.city },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: set });
  } catch (err) {
    next(err);
  }
});

router.get("/keyword-ideas", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { locationId } = ideaSetListSchema.parse(req.query);
    res.json({ success: true, data: await listIdeaSets(req.tenantId!, locationId) });
  } catch (err) {
    next(err);
  }
});

router.get("/keyword-ideas/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getIdeaSet(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.delete("/keyword-ideas/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteIdeaSet(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbKeywordIdeaSet",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- AI Description Optimizer (AdGrowly GMB-first, Phase 2) ------------------

const optimizeDescriptionSchema = z.object({
  text: z.string().trim().min(1).max(20000),
  keywords: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  maxLength: z.number().int().min(20).max(20000).optional(),
  businessName: z.string().trim().max(160).optional(),
  tone: z.enum(["professional", "friendly"]).optional(),
});

const createDescriptionSchema = z.object({
  target: z.nativeEnum(GmbDescriptionTarget).optional(),
  label: z.string().trim().max(160).optional(),
  original: z.string().trim().min(1).max(20000),
  keywords: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  maxLength: z.number().int().min(20).max(20000).optional(),
  businessName: z.string().trim().max(160).optional(),
  tone: z.enum(["professional", "friendly"]).optional(),
  locationId: z.string().cuid().optional(),
});

const descriptionListSchema = z.object({
  locationId: z.string().cuid().optional(),
  status: z.nativeEnum(GmbDescriptionStatus).optional(),
  target: z.nativeEnum(GmbDescriptionTarget).optional(),
});

const updateDescriptionSchema = z
  .object({
    optimized: z.string().trim().min(1).max(20000).optional(),
    label: z.string().trim().max(160).nullable().optional(),
    status: z.nativeEnum(GmbDescriptionStatus).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

// Preview an optimized description without saving — LLM-backed via the
// admin's gmb.description_optimizer prompt, deterministic fallback on failure.
router.post("/descriptions/optimize", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = optimizeDescriptionSchema.parse(req.body);
    res.json({ success: true, data: await optimizeDescriptionWithAi(req.tenantId!, input) });
  } catch (err) {
    next(err);
  }
});

router.post("/descriptions", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createDescriptionSchema.parse(req.body);
    const description = await createDescription(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbDescription",
      resourceId: description.id,
      newValues: { target: description.target, status: description.status },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: description });
  } catch (err) {
    next(err);
  }
});

router.get("/descriptions", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listDescriptions(req.tenantId!, descriptionListSchema.parse(req.query)) });
  } catch (err) {
    next(err);
  }
});

router.get("/descriptions/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getDescription(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/descriptions/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateDescriptionSchema.parse(req.body);
    const description = await updateDescription(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbDescription",
      resourceId: description.id,
      newValues: { fieldsUpdated: Object.keys(body), status: description.status },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: description });
  } catch (err) {
    next(err);
  }
});

router.delete("/descriptions/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteDescription(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbDescription",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- AI Ranking Advisor (AdGrowly GMB-first, Phase 2) -----------------------

const advisorListSchema = z.object({ locationId: z.string().cuid().optional() });
const generateAdviceSchema = z.object({ locationId: z.string().cuid() });

// Analyze a location's profile gaps → score + grade + weekly task list (saved).
router.post("/advisor", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { locationId } = generateAdviceSchema.parse(req.body);
    const advice = await generateAdvice(req.tenantId!, locationId, req.userId);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbAdvisorReport",
      resourceId: advice.id,
      newValues: { locationId, score: advice.score, grade: advice.grade },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: advice });
  } catch (err) {
    next(err);
  }
});

router.get("/advisor", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { locationId } = advisorListSchema.parse(req.query);
    res.json({ success: true, data: await listAdvice(req.tenantId!, locationId) });
  } catch (err) {
    next(err);
  }
});

router.get("/advisor/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getAdvice(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.delete("/advisor/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteAdvice(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbAdvisorReport",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- AI Image Generator (AdGrowly GMB-first, Phase 2) -----------------------

const imagePromptShape = {
  subject: z.string().trim().min(1).max(500),
  businessName: z.string().trim().max(160).optional(),
  style: z.string().trim().max(120).optional(),
  palette: z.string().trim().max(120).optional(),
  extras: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
};

const buildPromptSchema = z.object(imagePromptShape);

const createImageSchema = z.object({
  ...imagePromptShape,
  locationId: z.string().cuid().optional(),
  size: z.string().trim().max(16).optional(),
  quality: z.string().trim().max(40).optional(),
  provider: z.string().trim().max(80).optional(),
  secretId: z.string().cuid().nullable().optional(),
});

const imageListSchema = z.object({
  locationId: z.string().cuid().optional(),
  status: z.nativeEnum(GmbImageStatus).optional(),
});

const updateImageSchema = z
  .object({
    status: z.nativeEnum(GmbImageStatus).optional(),
    resultUrl: z.string().url().max(1000).nullable().optional(),
    error: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

// Preview the built image prompt without creating a request.
router.post("/images/prompt", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const input = buildPromptSchema.parse(req.body);
    res.json({ success: true, data: { prompt: buildImagePrompt(input) } });
  } catch (err) {
    next(err);
  }
});

router.post("/images", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = createImageSchema.parse(req.body);
    const image = await createImageRequest(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "GmbImageRequest",
      resourceId: image.id,
      newValues: { subject: image.subject, size: image.size },
      ...extractRequestMeta(req),
    });
    // Fire-and-forget auto-generation so creating a request immediately starts
    // the image (create stays fast; the page polls for READY/FAILED). Provider
    // trouble lands in FAILED inside the executor; a credit-gate rejection
    // throws before any status change, so surface it on the row instead.
    const tenantId = req.tenantId!;
    void processImageRequest(tenantId, image.id).catch(async (e) => {
      try {
        await updateImageRequest(tenantId, image.id, {
          error: e instanceof Error ? e.message.slice(0, 300) : "Auto-generation failed.",
        });
      } catch {
        /* best-effort */
      }
    });
    res.status(201).json({ success: true, data: image });
  } catch (err) {
    next(err);
  }
});

router.get("/images", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listImageRequests(req.tenantId!, imageListSchema.parse(req.query)) });
  } catch (err) {
    next(err);
  }
});

router.get("/images/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getImageRequest(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/images/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateImageSchema.parse(req.body);
    const image = await updateImageRequest(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbImageRequest",
      resourceId: image.id,
      newValues: { fieldsUpdated: Object.keys(body), status: image.status },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: image });
  } catch (err) {
    next(err);
  }
});

// Run the generation for a pending/failed request via the admin's IMAGE
// provider chain. Credit-gated; lands in READY or FAILED with the reason.
router.post("/images/:id/generate", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const image = await processImageRequest(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbImageRequest",
      resourceId: image.id,
      newValues: { generated: true, status: image.status },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: image });
  } catch (err) {
    next(err);
  }
});

router.delete("/images/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteImageRequest(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "GmbImageRequest",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- Customer Dashboard (AdGrowly GMB-first, Phase 2) -----------------------

const dashboardSchema = z.object({ locationId: z.string().cuid().optional() });

// Aggregated dashboard: business score, reviews, ranking, citations, posts,
// credits and alerts. Read-only (no audit).
router.get("/dashboard", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { locationId } = dashboardSchema.parse(req.query);
    res.json({ success: true, data: await getDashboard(req.tenantId!, locationId) });
  } catch (err) {
    next(err);
  }
});

// --- Business Profile sync (AdGrowly GMB-first) -----------------------------

const syncSchema = z.object({
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).max(10_000_000).optional(),
  verificationState: z.string().trim().max(60).optional(),
  source: z.enum(["MANUAL", "GOOGLE"]).optional(),
});

// Which locations are due for a sync (read-only).
router.get("/sync-status", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await listSyncStatus(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

// Sync a location. `source=GOOGLE` pulls reviews via the encrypted GBP
// credential; manual values remain supported for dev/test/back-office entry.
router.post("/locations/:id/sync", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = syncSchema.parse(req.body ?? {});
    const location = await syncLocation(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbLocation",
      resourceId: req.params.id,
      newValues: { synced: true },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
});

// --- Scheduled-post publisher (AdGrowly GMB-first) --------------------------

// Publish all due scheduled posts now (also callable from a cron/worker later).
// Recurring report schedule (opt-in, default off) — drives the auto-report worker.
router.get("/report-schedule", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getReportSchedule(req.tenantId!) });
  } catch (err) {
    next(err);
  }
});

const reportScheduleSchema = z.object({
  enabled: z.boolean(),
  frequency: z.nativeEnum(GmbReportType).optional(),
});

router.put("/report-schedule", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = reportScheduleSchema.parse(req.body);
    const data = await setReportSchedule(req.tenantId!, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbReportSchedule",
      resourceId: req.tenantId!,
      newValues: { enabled: data.enabled, frequency: data.frequency },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.post("/posts/run-scheduled", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const result = await publishDuePosts(req.tenantId!);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "GmbPost",
      newValues: { publishedCount: result.published },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
