# GMB Suite — Roadmap Status

_Original audit generated from all 59 screens, 55 services, and 7 route modules (Aug 2026). Updated after the main-branch integration on 2 Aug 2026._

## Current status

All branch-only work has been integrated into `main`. The launch-critical set from the original Bucket 1
and Bucket 2 audit is implemented, including plan enforcement, live Google sync controls, Google OAuth
configuration, provider-key tests, accurate image charging, durable generated-image storage, cross-process
worker health, queue recovery controls, rank alerts, and corrected money aggregates.

Google profile verification now uses Google's live verification-options, start, and PIN-completion APIs;
the app no longer marks a profile verified from a local code alone. Public `/features`, `/pricing`, and
`/agencies` routes now follow the supplied designs, and pricing comes from the active database catalog.

The code-completable Bucket 3 workflows are now implemented as configuration-ready features: DNS-verified
white-label domains and senders, Google Q&A and Place Actions writes, provider refunds, immutable tax invoices,
partner settlement checkout, approved-content publishing, scheduled report email, support workflow, money-list
pagination, scheduled rank captures, email mutation gating, and resale-plan archive/reorder. Production remains
fail-closed until the required provider credentials, DNS routing and seller identity are supplied.

## Original audit baseline (historical)

The following tables are preserved as the implementation checklist that led to the current state. Bucket 1
and Bucket 2 are complete; their estimates are no longer remaining work.

---

## Bucket 1 — Bugs & wrong/incomplete backend logic (completed)
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

## Bucket 2 — Backend/UI wiring (completed)
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

## Bucket 3 — Product workflows (implementation status)
_External-provider features fail closed until their production access and credentials are configured._

| # | Feature | Status |
|---|---------|--------|
| A | Citation scanning | Complete as an honestly labelled manual NAP tracker; paid aggregator crawling is not simulated. |
| B | White-label domain and sender | Complete: DNS TXT/CNAME verification, domain uniqueness, tenant branding lookup, dynamic CORS and verified-domain sender enforcement. TLS/host routing is deployment infrastructure. |
| C | Google Q&A sync | Complete: live question sync and explicit merchant-answer publish through the official GBP API. |
| D | Google Verifications API | Complete; production use requires Google's API allow-listing. |
| E | Google Place Actions API | Complete: explicit create/update/delete against the official API. |
| F | Turn on paid subscriptions | Financial switch remains intentionally off until the final price catalog and start-charging approval are supplied. Credit top-ups and plan entitlements are live. |
| G | Gateway refunds | Complete: Stripe and Razorpay provider refund happens before the credit-ledger reversal, with idempotency. |
| H | Tax/GST invoices | Complete: immutable snapshots, financial-year sequential numbers, tax-inclusive GST split, billing profile and authenticated server PDF. Requires seller identity env values. |
| I | Platform→partner settlement | Complete: monthly frozen invoice lifecycle, due/overdue state and one-currency Razorpay/Stripe settlement checkout/webhook. |
| J | Approved AI content publishing | Complete as explicit operator-controlled publish: descriptions update the GBP profile and images create editable Google post drafts. |
| K | Scheduled reports | Branded PDF generation and SMTP email delivery complete with observable delivery errors. WhatsApp requires a selected BSP/API account. |
| L | Support workflow | Complete: customer email notification, private staff notes, assignee, priority and state controls. |
| M | Admin pagination | Complete for accounts, users, audit and money lists, including filters/search/CSV where applicable. |
| N | Scheduled single-keyword ranks | Complete: opt-in cadence, BullMQ worker and visible last-run/error state. |
| O | Email verification and branded sender | Complete: unverified users are read-only for protected mutations; verified tenant domains may send branded mail. |
| P | Resale-plan polish | Complete: archive, restore and deterministic reorder. |

---

## Bucket 4 — Config / keys you must provide to go live (your task, ~0 code)
The code is live but **fails closed** until real values are set (documented in `GO-LIVE.md`):
`GOOGLE_CLIENT_ID/SECRET` (⚠️ rotate the one committed in `.env`), `GOOGLE_PLACES_API_KEY`,
`ANTHROPIC_API_KEY`, `RAZORPAY_*`, `STRIPE_*`, `SMTP_*`, and S3/R2 storage config. Redis + `ENABLE_WORKERS=true`
for auto-sync/autopilot/scheduled posts & reports.

---

## Historical timeline estimate

| Scope | Hours | Solo calendar |
|-------|-------|---------------|
| **Launch-critical** = Bucket 1 (bugs) + Bucket 2 (wiring) | **~74h** | **~2 weeks** |
| + the "must-decide" launch features you greenlight from Bucket 3 | +40–120h | +1–3 weeks |
| **Everything** (all buckets) | **~307h** | **~7–8 weeks** |

I can compress calendar time heavily by fanning out with parallel agents (Ultracode) — realistically the
launch-critical set can land in a few focused days.

## Go-live order
1. Supply the **Bucket 4** credentials, invoice seller identity and custom-domain routing/TLS.
2. Confirm final subscription prices and the date charging may start; then enable the billing switch.
3. Choose a WhatsApp BSP if WhatsApp report delivery is required.
4. Run real-provider end-to-end acceptance tests in the deployment environment.

## Branch policy
`main` is the integration and delivery branch. Feature/test branch histories have been merged into it; new
delivery work should be committed and pushed directly to `main` unless this policy is explicitly changed.
