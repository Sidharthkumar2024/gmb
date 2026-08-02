# gmb

The standalone Adgrowly Google Business Profile (Local SEO) platform.

## Status

**The API and web app run standalone.** The platform includes the business,
partner, and admin portals; Postgres migrations; background workers; billing and
wallet flows; Docker packaging; and CI. The current suite passes 577 tests across
63 files, and the Next.js production build generates 61 routes.

Production activation still requires real environment secrets and provider
credentials. Follow `GO-LIVE.md` for deployment and operational checks.

## Quick start

```bash
npm install
cp .env.example .env            # then set DATABASE_URL and JWT_SECRET
npm run db:push                 # create the schema
npx tsx packages/db/prisma/seed.ts
npx tsx apps/api/src/index.ts   # http://localhost:3001
```

```bash
curl -s localhost:3001/api/v1/health
TOKEN=$(curl -s -X POST localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@adgrowly.local","password":"Demo@1234"}' | jq -r .data.accessToken)
curl -s localhost:3001/api/v1/gmb/locations -H "Authorization: Bearer $TOKEN"
curl -s localhost:3001/api/v1/gmb/health -H "Authorization: Bearer $TOKEN"   # probes all 12 GMB tables
```

Background workers (auto-sync, autopilot, post publisher, report scheduler) are
opt-in via `ENABLE_WORKERS=true`. Run them on exactly one process — every replica
that enables them will independently sync Google and publish posts, producing
duplicate writes against a rate-limited API.

## ⚠️ Before charging anyone money

`billing.service.ts` is **balance-only**: it decrements a wallet with no
transaction ledger, no idempotency key and no refund path. The monorepo debits
through an idempotent ledger; that model was not carried over.

Billing is therefore **off by default** (`WALLET_BILLING_ENABLED` unset). Add a
`WalletTransaction` model and an idempotent adjust before enabling it — a
balance-only debit cannot be audited or reversed, and a retried request would
double-charge.

## What's in here

| Path | Contents |
|---|---|
| `apps/api/src/services/` | 61 GMB services + the ported platform layer |
| `apps/api/src/routes/` | `gmb.routes.ts` (the whole GMB surface) + `auth.routes.ts` |
| `apps/api/src/middleware/` | auth (JWT), rbac, error handler |
| `apps/web/app/` | 12 Next.js page directories (no app shell yet) |
| `apps/web/src/components/` | 6 React components |
| `packages/db/` | Prisma schema (47 models + enums), client, seed |
| `packages/shared/` | `ApiError`, `ErrorCodes`, `Permissions`, roles |
| `docs/` | Coupling analysis + Google GBP integration notes |

Features covered: locations and sync, reviews with AI-drafted replies, Q&A, posts
and content authoring, rank tracking with grid snapshots and a competitor battle
map, citations, insights, reports and scheduling, place actions, verifications,
descriptions, images, and the advisor.

### Deliberately excluded

- **`gmb-admin/`** — despite the name, this is **not** a GMB admin. Its pages are
  `customers`, `invoices`, `partners`, `transactions`, `api-key`, and it calls
  `/api/v1/tenants`. It is a generic tenant/billing admin that happens to carry a
  `gmb-` prefix. Including it here would have been misleading.
- Platform infrastructure GMB *uses* but does not own (see below).

## What the original extraction was missing

Every dependency below originally resolved only inside the monorepo. The
standalone app now supplies these contracts; the list is retained as extraction
history:

**Packages** — `@nexaflow/db` (40 imports, incl. the Prisma client and the `Tenant`
model), `@nexaflow/shared` (22).

**Platform services** — `ai.service` (7), `queue` (4), `brandKit.service` (3),
`billing.service` (3), `tokenCrypto` (2), `secretVault.service` (2),
`aiPromptTemplate.service` (2), and one each of `ssrfGuard`,
`publicObjectStorage`, `googleOAuthConfig.service`, `googleApiMonitor.service`,
`productAccess.service` and `rbac`.

**Also originally absent** — auth/JWT middleware, tenancy resolution, the audit log, the
4 background workers' registration (`GmbAutoSync`, `GmbAutopilot`,
`GmbPostPublisher`, `GmbReportSchedule` are started from the monorepo's
`index.ts`), env config, build tooling, and CI.

### The one structural dependency that matters

Every `Gmb*` model's sole relation outside the GMB set is `tenant → Tenant`
(`onDelete: Cascade`). There are **no** relations to `User`, `Contact`, `Message`,
`Campaign`, or `Wallet`.

That is what makes this subsystem cleanly separable — but it also means
`prisma/gmb.models.prisma` will not validate until you supply a `Tenant` model or
swap that relation for your own account/owner concept. Note that if GMB ever moves
to its own database, the cascade delete becomes application-level cleanup; forget
it and you orphan data silently rather than failing loudly.

## Standalone application foundation

The standalone implementation now includes:

1. A validating Prisma schema with tenant ownership and production migrations.
2. Authentication, tenancy, RBAC, and audit logging.
3. Focused platform services for AI, queues, crypto, storage, email, and billing.
4. Registered background workers with health visibility.
5. Environment configuration, build tooling, Docker, and CI.

`docs/GMB_EXTRACTION_ANALYSIS.md` has the measured coupling data behind all of
this, including per-portal state and the gotchas worth knowing before you start.

## Status of the portals

- **User / business panel** — complete and wired to the API.
- **SuperAdmin** — operational screens for accounts, billing, plans, providers,
  health, queues, storage, support, audit, and Google configuration.
- **Partner / white-label** — operational overview, customer management, plans,
  invoices, transactions, team, branding, support, gateway, and Google setup.

## Licence / provenance

Extracted from a private monorepo. Commit history was not carried over, so
`git blame` here will show a single import commit rather than real authorship.
