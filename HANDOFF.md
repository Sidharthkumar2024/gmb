# Adgrowly GMB Suite — Handoff: remaining work

Hand this file to the other Claude account. It is self-contained: it does not
assume the other session saw any prior conversation.

## What this project is

Standalone Google Business Profile SaaS. npm workspaces:
`packages/db` (Prisma), `packages/shared`, `apps/api` (Express + tsx, :3001),
`apps/web` (Next.js 14 App Router, :3000). Package names are `@nexaflow/db` /
`@nexaflow/shared` (kept for history; the product is "Adgrowly GMB Suite").

Three UIs, each with its own shell + design tokens:
- **Suite** (customer) — `GmbShell` + `ui.tsx`, `gmb-*` tokens.
- **Admin** (super admin) — `AdminShell` + `AdmCard/AdmLabel/AdmPill`, `adm-*` tokens (dark purple). `requireRole SUPER_ADMIN`.
- **Partner** (white-label) — `PartnerShell` + `Ptn*`, `ptn-*` tokens (dark green). `requireRole WHITE_LABEL_ADMIN`.

Seed logins (`packages/db/prisma/seed.ts`): super `super@adgrowly.local` / `Super@1234`;
customer `demo@…` / demo pw; partner `partner@adgrowly.local` / `Partner@1234`.

## Non-negotiable rules (money integrity + security)

1. **Credits flow only through `grantCredits`** (`billing.service.ts`). It writes
   an idempotent `WalletTransaction` (RESERVE/SETTLE/RELEASE/GRANT/REFUND) keyed
   on `idempotencyKey`. Never write a wallet balance directly. The ledger is the
   source of truth: `SUM(deltaCredits) per wallet == balance`.
2. **`Payment` is idempotent on `providerPaymentId`** (upsert, update is a no-op).
   Invoices are derived one-per-Payment (`invoice.service.ts`).
3. **No fabricated figures.** Revenue / commission / margin come from real
   `Payment` + `WalletTransaction` rows, or the screen says the number isn't
   available yet. Never hardcode a plausible number.
4. **Secrets:** gateway/payment/AI keys live in **env per provider** or the
   **Secret Vault** (PLATFORM/PARTNER scope, only last-4 ever returned to the
   browser). Never commit `.env` / secrets / `.claude`.
5. **Webhooks** verify the signature against the RAW body, then credit. Public
   webhook routes MUST be mounted BEFORE the authed `/api/v1` catch-all in
   `apps/api/src/index.ts` or `requireAuth` 401s them.
6. **Coordination:** main moves under you (two accounts commit here). Before each
   slice: `git fetch && git rebase origin/main` (or merge) — never force-push,
   never clobber the other account's commits. Small, focused commits.

## House workflow — every slice

1. Build ONE coherent slice.
2. `npm run -w apps/api typecheck` → 0, `cd apps/web && npx tsc --noEmit` → 0.
3. `npx vitest run` green (add colocated tests for new ledger/gateway/money logic).
4. Live-verify in the browser as the correct role (start API + web, seed a
   minimal test row if needed, confirm the endpoint + the page render real data).
5. Clean all test data back to seed state.
6. Commit + push in house style. Every commit message ends with:
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Done so far (do NOT rebuild)

Gateway abstraction (Razorpay + Stripe, `paymentGateway.service.ts`), customer
top-up loop + wallet ledger (`gmb-billing`), admin Payments + Transactions
(`Payment` model), admin Invoices (derived, `invoice.service.ts`,
`/admin/invoices` + printable detail). Partner portal: overview, branding, team,
google, support. ~30 screens live.

## Remaining slices — give these as commands, in order

### Slice 5 — Partner billing suite (largest; do the sub-steps as separate commits)

Partner currently has NO billing surface. Build a wholesale/commission model on
the existing tenant hierarchy (`Tenant.parentTenantId`: partner → child
customers) and the existing `Payment` records of those children.

- **5a — Partner resale plans.** Extend `Plan` with a `wholesaleCents` + partner
  scope (or a `PartnerPlan` model). Partner sets a retail price; margin =
  retail − wholesale. `partner.routes` CRUD + `/partner/plans` (Ptn theme).
- **5b — Partner transactions.** Partner-scoped view of their CHILD tenants'
  `Payment`s only (scope by `parentTenantId` — a partner must never see another
  partner's or the platform's payments). `/partner/transactions`.
- **5c — Partner gateways.** Partner points its own gateway keys (reuse the
  Slice-1 abstraction, PARTNER-scope vault). `/partner/gateways`.
- **5d — Partner invoices + commission.** Wholesale invoices Adgrowly bills the
  partner (active child tenants × wholesale) + commission accrual. Needs a
  **monthly BullMQ job** (follow the existing schedulers, e.g.
  `gmbScheduler.service.ts`). `/partner/invoices`; make the sidebar commission
  card real. Split further at build time — this is the deepest piece.

Acceptance: a partner sees ONLY its children's data; every figure traces to real
`Payment`/`WalletTransaction` rows; mutations audited.

### Slice 6 — Admin image storage

There is already `apps/api/src/lib/publicObjectStorage.ts` (used by branded
images) — build ON it, don't start over.

- Object-storage config (S3/R2: bucket/region/keys) in the PLATFORM vault.
- `storage.service` with signed upload/read, layered over `publicObjectStorage`.
- `/admin/storage` admin screen to configure + test it.
- Wire real uploads where the UI currently only accepts a URL (partner branding
  logo, GMB post images). Only ship the upload path once something actually uses
  it — no decorative config screen.

### Slice 7 — Reconcile branches + QA + wire real keys

Branch state on origin (checked 2026-07-26):
- `fix/gmb-billing-nav` — 1 commit ahead of main. Review + merge or discard.
- `perf/api-inflight-get-dedup` — 2 commits ahead. Review + merge or discard.
- `fix/gmb-code-review-fixes`, `fix/razorpay-topup-credit` — 0 ahead of main
  (already folded in). Safe to `git branch -D` / delete on origin.

Then: pass over all screens; wire real keys (Anthropic, Google Places, SMTP,
gateway) so AI / email / rank / payments light up end to end. Rotate the Google
client secret that was exposed earlier before going live.

## Verification cheats

- Signed Razorpay webhook: HMAC-SHA256 the raw JSON body with the webhook secret,
  send as `x-razorpay-signature`. Replay it → wallet must NOT double-credit
  (check `WalletTransaction.idempotencyKey`) and Payment stays 1 row.
- SMTP sink: maildev. AdmLabel/SectionLabel apply CSS `text-transform` — assert
  page text case-insensitively.
- Migrations: `npx prisma migrate dev --name X` (needs `DATABASE_URL`;
  `export $(grep -v '^#' .env | grep DATABASE_URL)`).
