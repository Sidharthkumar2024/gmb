# GMB extraction analysis — can the GMB product be separated?

- **Date**: 2026-07-20
- **Status**: Analysis only. No code changed. Written to support a decision, not to pre-commit to one.
- **Question asked**: can the GMB code be separated across the user panel, admin panel and white-label portals?

---

## Verdict

**Yes — GMB is the most cleanly separable subsystem in this repo.** It is very nearly a *leaf module*: a large amount of code hanging off a very small number of attachment points.

But the question contains an assumption worth correcting up front:

> **There is nothing to "separate" for white-label — that surface does not exist yet.**
> Partner/white-label has **zero** GMB pages, **zero** GMB routes, and `WHITE_LABEL_ADMIN`
> does not even hold the `GMB_MANAGE` permission. That is a *build*, not a *split*, and it
> is the majority of the work under any option below.

The same is partly true of admin: what exists is scattered infrastructure config, not a GMB admin panel (see [Per-portal reality](#per-portal-reality)).

---

## Measured surface

| Layer | Measure |
|---|---|
| API services | **61 files**, **8,207 LOC** (excluding tests) |
| API routes | `gmb.routes.ts` — **2,449 lines**, one mount, one guard |
| Background workers | **4** (`GmbAutoSync`, `GmbAutopilot`, `GmbPostPublisher`, `GmbReportSchedule`) |
| Prisma models | **19** `Gmb*` models |
| Web pages | **13** `gmb-*` route dirs |
| Web components | **6** `Gmb*` components |
| Env vars | `GOOGLE_PLACES_API_KEY` + ~7 `GMB_*` tuning vars |

---

## Coupling — the part that decides everything

### Inbound (core → GMB): 3 files

Only three non-GMB files reference GMB at all:

- `apps/api/src/index.ts` — mounts `/api/v1/gmb`, starts the 4 workers
- `apps/api/src/routes/admin-google-monitor.routes.ts`
- `apps/api/src/routes/admin-ai-prompts.routes.ts`

Nothing else in the codebase depends on GMB. **This is the number that makes extraction viable** — removing GMB breaks three files, all of them at the composition root or in admin tooling.

### Outbound (GMB → core): 13 modules, all generic infrastructure

`ai.service` (×7), `queue` (×4), `secretVault.service` (×2), `tokenCrypto`, `ssrfGuard`,
`publicObjectStorage`, `googleOAuthConfig.service`, `googleApiMonitor.service`,
`email.service`, `brandKit.service`, `billing.service`, `aiProviderHub.service`,
`aiPromptTemplate.service`.

The route layer adds: `auth`, `rbac`, `audit.service`, `sendThrottle.service`, `whatsapp.service`.

**Every one of these is generic platform plumbing** — AI gateway, job queue, secret storage, crypto, SSRF guard, object storage, email, billing, audit. None is WhatsApp-product logic. In a split these are either duplicated (small, boring) or published as a shared `packages/platform`.

### The only genuine product coupling: 2 endpoints

`gmb.routes.ts` imports `sendWhatsAppText` for exactly two routes:

- `POST /reports/:id/share-whatsapp` — send a GMB report to a customer over WhatsApp
- `POST /review-request` — the Phase C review-request automation

These are the deliberate **GMB × WhatsApp cross-sell features**. They are the only place the two products touch. In a standalone GMB they become either (a) removed, (b) re-pointed at email/SMS, or (c) calls back to the WhatsApp product's public API.

---

## Database boundary — unusually clean

All 19 `Gmb*` models were checked for relations pointing outside the GMB set. The result:

**Every single outbound relation is `→ Tenant`. There are zero relations to `User`, `Contact`, `Message`, `Campaign`, `Wallet`, or any other core model.**

```
GmbPost, GmbLocation, GmbVerificationRequest, GmbPlaceAction, GmbQuestion,
GmbReview, GmbTrackedKeyword, GmbRankAlertRule, GmbRankSnapshot,
GmbRankGridSnapshot, GmbInsightSnapshot, GmbCitation, GmbReport,
GmbKeywordIdeaSet, GmbDescription, GmbAdvisorReport, GmbImageRequest
        └── tenant → Tenant (onDelete: Cascade)   ← the ONLY foreign edge
```

`Tenant` is the single shared concept. That is the textbook shape for extraction: one identity/tenancy seam to decide about, and nothing else to untangle.

---

## Per-portal reality

This is where expectation and code diverge most.

### User / business panel — ✅ complete

12 pages, fully built and wired: `gmb`, `gmb-advisor`, `gmb-citations`, `gmb-connect`,
`gmb-dashboard`, `gmb-descriptions`, `gmb-images`, `gmb-insights`, `gmb-locations`,
`gmb-ranking`, `gmb-reports`, `gmb-reputation`.

Access is a single RBAC line at the top of the router:

```ts
router.use(requireAuth, requireTenantScope, requirePermission(Permissions.GMB_MANAGE));
```

`GMB_MANAGE` is granted to `BUSINESS_ADMIN` (and `SUPER_ADMIN` via `Object.values`).

Note there is **no GMB feature flag** — GMB is permission-gated, not feature-gated. If GMB is to be sold as a separate SKU, that is a gap: a tenant either has the permission or not, with no per-tenant module toggle.

### Admin — ⚠️ partial and scattered

What exists is *infrastructure config that GMB happens to need*, not a GMB admin:
Google OAuth config, `admin-google-monitor.routes.ts` (API quota/health),
`admin-ai-prompts.routes.ts`.

> **Naming trap:** `apps/web/app/gmb-admin/` is **not** a GMB admin panel. Its subpages are
> `customers`, `invoices`, `partners`, `transactions`, `api-key`, and it calls
> `/api/v1/tenants` and `/api/v1/api-keys`. It is a generic tenant/billing admin that
> happens to carry a `gmb-` prefix. Anyone planning this work will misread it — rename it.

There is no consolidated view of GMB across tenants (locations synced, quota burn, autopilot state, failures).

### White-label / partner — ❌ does not exist

- `grep -rl gmb apps/web/app/partner` → **0 files**
- `WHITE_LABEL_ADMIN` does **not** hold `GMB_MANAGE`
- No partner-facing GMB routes

Partners cannot see, resell, or manage GMB in any form today.

---

## The three things "separate the code" could mean

### Option A — Module boundary inside the monorepo

Move GMB behind an explicit interface (`packages/gmb` or an enforced import boundary), keeping one deploy, one database, one auth.

- **Effort**: moderate, mostly mechanical — the hard part (dependency untangling) is largely absent
- **Risk**: low, reversible
- **Unlocks**: honest dependency rules, independent testing, and it is the prerequisite for Option B
- **Main work**: define the public surface, invert the 5 route-layer couplings, decide where the 13 infra modules live

### Option B — Standalone product / separate repo

Carve GMB out to run and sell independently (Adgrowly standalone).

- **Effort**: large — but *not* because of coupling. The cost is everything a product needs that GMB currently borrows: its own auth, tenancy, billing, wallet, admin, deploy, CI, domain.
- **Risk**: high if done directly from today's state
- **Blocked on a real decision**: does standalone GMB share the `Tenant` table (one DB, two products) or own its own identity (two DBs, federated login)? Everything else follows from that answer.
- **Should follow Option A**, not replace it

### Option C — Build the missing per-portal surfaces

Leave the code where it is; build what is absent: partner/white-label GMB (from zero) and a real consolidated SuperAdmin GMB panel.

- **Effort**: medium-large, but it is *feature work* with no refactor risk
- **Delivers user-visible value immediately**, unlike A and B
- Needs a **GMB feature flag** first, so partners can enable/disable it per customer

---

## Recommended order

1. **Add a GMB feature flag** (small). Today GMB is permission-gated only. Every other option needs per-tenant on/off, and selling GMB as a SKU is impossible without it.
2. **Rename `gmb-admin/`** (trivial). It is a mislabelled generic tenant admin and will mislead anyone doing this work.
3. **Option A — module boundary** (moderate, low risk). Cheap now precisely because inbound coupling is 3 files; it gets more expensive with every feature added.
4. **Option C — partner/white-label GMB + real admin panel** (the actual product gap).
5. **Option B — standalone** only if the business case is real, and only after 1–4.

---

## Gotchas for whoever does this

- **`gmb-admin/` is not GMB.** Rename before planning.
- **No feature flag.** `GMB_MANAGE` is all-or-nothing per role.
- **The 2 WhatsApp endpoints** (`/reports/:id/share-whatsapp`, `/review-request`) are the only cross-product code. Decide their fate explicitly — they are also the cross-sell story, so deleting them has a product cost.
- **4 background workers** are started from `index.ts` and must move with the module, along with their `GMB_*` env vars.
- **`GOOGLE_PLACES_API_KEY` is env-only**, not in the admin Secret Vault (already tracked in TASKS.md bucket B). A standalone GMB makes this more painful, so do that first.
- **`Tenant` cascade delete** reaches all 19 GMB models. If GMB ever moves to its own database, that cascade becomes application-level cleanup — easy to forget, and it silently orphans data rather than failing loudly.
