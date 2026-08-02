# GMB Suite — Remaining Work Inventory & Estimate

_Generated from an 8-agent audit of all 59 screens, 55 services, 7 route modules (Aug 2026)._

## Verdict

The app is **~85–90% built and mostly real** — not a half-finished shell. Money views read the actual
`WalletTransaction` ledger, payments come from signature-verified webhooks, Google Business Profile /
Places / AI image / AI text / email are all live integrations, and admin/partner/suite screens persist
to real Prisma data. **No fabricated figures were found.**

What remains falls into 4 buckets. Total to bring *everything* to production-done: **≈ 307 engineer-hours**.
But that includes large optional product features. The **launch-critical subset is ≈ 90–110h (~2–3 weeks solo).**

---

## Bucket 1 — Bugs & wrong/incomplete backend logic to FIX (≈ 34h)
_These are correctness issues, several of them "changed away from intended behaviour."_

| # | Item | File(s) | Est |
|---|------|---------|-----|
| 1 | AI **image cost logged as `costInCents: 0`** → admin AI-spend + all AiUsage cost totals silently exclude image cost | `gmbImage.service.ts:379` | 2h |
| 2 | **Plan `maxKeywords` / `maxUsers` never enforced** (only `maxLocations` is) — limits are stored & shown as active but do nothing | `plan.service.ts`, keyword-add + user-invite call sites | 5h |
| 3 | **Google OAuth client not settable from console** — `saveGoogleOAuthConfig` is dead code (no route/UI); `/admin/google` is view-only, creds resolve from env only | `googleOAuthConfig.service.ts`, `admin.routes.ts`, `/admin/google` | 6h |
| 4 | **AI image URLs expire (~1h)** — DALL·E/provider URLs stored as-is, never re-hosted → generated images become dead links | `gmbImage.service.ts` (+ storage) | 4h |
| 5 | **Descriptions "Save draft" discards the AI output** — re-runs the template instead of persisting the previewed AI text | `gmbDescription.service.ts`, `/gmb-descriptions` | 3h |
| 6 | **Credit ledger `debitAi`** row correctness issue (flagged PARTIAL/BUG; verify SUM(deltaCredits)==balance holds when billing on) | `billing.service.ts` | 4h |
| 7 | **Verifications page falsely claims "Verified on Google"** after a local code entry — no real Google Verifications call | `/gmb-verifications`, `gmbVerification.service.ts` | (see Bucket 3) |
| 8 | **Health "workers" badge** echoes the serving process's env flag, misreports in split worker/web deploys | `/admin/health` | 6h |
| 9 | **Invoice "Billed" card sums INR paise + USD cents together** (mixed-currency) | `/admin/invoices` | 2h |
| 10 | Headline money/AI stats computed over only the **most-recent 200 rows** (not true all-time) | admin overview/payments/invoices | 2h |

---

## Bucket 2 — Backend EXISTS but is unreachable from the UI (wire it up) (≈ 40h)
_High ROI: the hard part is already written and tested; it just needs a button + a bit of glue. Uses the existing design system, no new screens._

| # | Item | Backend that already exists | Est |
|---|------|------------------------------|-----|
| 1 | **"Import locations from Google"** button | `POST /gmb/google/sync-locations` → `syncGoogleLocations` (lists + upserts real Google locations) | 4h |
| 2 | **Per-location live "Sync from Google"** (reviews + insights) | `syncGoogleReviewsForLocation`, `syncGoogleInsightsForLocation` (real v4 + Performance API) | 5h |
| 3 | **"Disconnect Google"** control | `POST /gmb/google/disconnect` | 1h |
| 4 | **Insights "Sync from Google" + date-range picker** (period deltas already built, unreachable) | `syncGoogleInsightsForLocation`, period-over-period logic | 6h |
| 5 | **Rank-drop alert rules UI** (backend + email already built) | `gmbRankAlert.service.ts` | 5h |
| 6 | **Post composer must select a connected location** so "Published" actually reaches Google | `gmbPostPublisher` worker path exists | 8h |
| 7 | AI "test key" — surface a **live provider ping** button (currently decrypt-only stub) | `secretVault.testSecret` (upgrade to real ping) | 4h |
| 8 | Queue admin: **retry/purge/pause** failed jobs | BullMQ (`lib/queue.ts`) | 7h |

---

## Bucket 3 — Big features gated on YOUR product decision (≈ 233h)
_These are real builds; doing them the wrong way wastes days, so they need a yes/no first._

| # | Feature | What "done" means | Decision needed | Est |
|---|---------|-------------------|-----------------|-----|
| A | **Real citation scanning** | Actually crawl Justdial/Zomato/Bing/Apple etc. | Needs a paid aggregator (Yext/BrightLocal $$) OR relabel as manual NAP tracker | 20h |
| B | **White-label actually applied** | Logo/colour/hide-powered-by re-skin customer workspaces + custom-domain serving + DNS verify | Full re-skin + domain infra, or portal-preview MVP? | 32h |
| C | **Google Q&A sync** | Read questions from Google + post approved answers back | In scope for launch? Needs GBP API | 10h |
| D | **Google Verifications API** | Real verify flow (stop faking "Verified") | Needs Google API allow-listing | 14h |
| E | **Google Place Actions API** | Book/Order/Reserve links actually publish to Google | Needs GBP API | 10h |
| F | **Turn ON billing** | `WALLET_BILLING_ENABLED=true`, plan `priceCents` actually charged (subscription) | When to start charging? Final prices? | 20h |
| G | **Auto gateway refunds** | Refund hits Razorpay/Stripe API (today: ledger reversal only, manual money-back) | Auto or stay manual? | 8h |
| H | **Tax/GST invoices** | Stored `Invoice` model, sequential numbering, GST breakdown, real seller identity, server-side PDF | Compliance requirement? | 24h |
| I | **Platform→partner settlement** | Actually collect the monthly wholesale from partners (dunning/suspend) | Auto-charge or manual invoice? | 20h |
| J | Approved AI images/descriptions **auto-push to Google** profile/posts | vs manual copy/download | Auto or manual? | 12h |
| K | Real **report PDF** (charts, branded A4) + **email/WhatsApp delivery** of scheduled reports | pdfkit is not even a dependency yet | Styled PDF + delivery? | 15h |
| L | Support reply → **email the customer**; internal notes; assignee; state machine | Notify + workflow? | 12h |
| M | Pagination + filtering on admin lists (audit, accounts, users, money) for scale | Needed at your scale? | 16h |
| N | Single-keyword rank tracker on a schedule (grid is on-demand only) | Scheduled rank worker? | 6h |
| O | Enforced email verification gate; per-tenant sender domains | Gate login/paid actions? | 6h |
| P | Resale-plan archive/reorder; misc partner polish | — | 8h |

---

## Bucket 4 — Config / keys you must provide to go live (your task, ~0 code)
The code is live but **fails closed** until real values are set (documented in `GO-LIVE.md`):
`GOOGLE_CLIENT_ID/SECRET` (⚠️ rotate the one committed in `.env`), `GOOGLE_PLACES_API_KEY`,
`ANTHROPIC_API_KEY`, `RAZORPAY_*`, `STRIPE_*`, `SMTP_*`, and S3/R2 storage config. Redis + `ENABLE_WORKERS=true`
for auto-sync/autopilot/scheduled posts & reports.

---

## Timeline estimate

| Scope | Hours | Solo calendar |
|-------|-------|---------------|
| **Launch-critical** = Bucket 1 (bugs) + Bucket 2 (wiring) | **~74h** | **~2 weeks** |
| + the "must-decide" launch features you greenlight from Bucket 3 | +40–120h | +1–3 weeks |
| **Everything** (all buckets) | **~307h** | **~7–8 weeks** |

I can compress calendar time heavily by fanning out with parallel agents (Ultracode) — realistically the
launch-critical set can land in a few focused days.

## Recommended build order
1. **Bucket 1 bugs** (correctness first — no decisions needed, non-colliding).
2. **Bucket 2 wiring** (huge ROI, existing components).
3. Whatever you greenlight from **Bucket 3** for launch.
4. You supply **Bucket 4** keys → end-to-end flow test → bug sweep.

## Note on parallel sessions
Right now three efforts touch this repo: your other account's **payment** work, a running **upload-hardening**
task (storage/uploads files), and me. I'll avoid those files to prevent conflicts and start with the
non-colliding Bucket 1/2 items.
