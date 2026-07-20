# gmb

The Google Business Profile (Local SEO) subsystem, extracted from the NexaFlow AI
monorepo (`Sidharthkumar2024/whatsapp-api`).

## Read this first

**This is a source extract, not a runnable application.** Nothing here boots on its
own. It is the GMB code lifted out of a larger platform, published so the subsystem
can be read, reviewed, or used as the starting point for a standalone product.

If you want to *run* GMB today, run it from the monorepo — it is complete and
working there, and as of the `local_seo` product registration it can be sold and
enabled per customer as its own SKU.

## What's in here

| Path | Contents |
|---|---|
| `api/services/` | 61 service files (~8,200 LOC incl. colocated tests) |
| `api/routes/` | `gmb.routes.ts` — the whole GMB API surface (~2,450 lines) |
| `web/app/` | 12 Next.js page directories |
| `web/components/` | 6 React components |
| `prisma/gmb.models.prisma` | 19 `Gmb*` models + 13 enums |
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

## What is missing, and why it won't run

Every import below resolves inside the monorepo and does not exist here. This list
is derived from the extracted source, not from memory:

**Packages** — `@nexaflow/db` (40 imports, incl. the Prisma client and the `Tenant`
model), `@nexaflow/shared` (22).

**Platform services** — `ai.service` (7), `queue` (4), `brandKit.service` (3),
`billing.service` (3), `tokenCrypto` (2), `secretVault.service` (2),
`aiPromptTemplate.service` (2), and one each of `ssrfGuard`,
`publicObjectStorage`, `googleOAuthConfig.service`, `googleApiMonitor.service`,
`productAccess.service`, `sendThrottle.service`, `rbac`, `whatsapp.service`.

**Also not included** — auth/JWT middleware, tenancy resolution, the audit log, the
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

## Two WhatsApp couplings

`gmb.routes.ts` imports `sendWhatsAppText` for exactly two endpoints:

- `POST /reports/:id/share-whatsapp`
- `POST /review-request`

These are the deliberate GMB × WhatsApp cross-sell features and the only place the
two products touch. Standalone, they need to be removed, re-pointed at email/SMS,
or turned into calls back to the WhatsApp product's API. Deleting them has a
product cost, not just a code one.

## Turning this into a real application

Roughly, in order:

1. Provide `Tenant` (or your own owner model) and get the Prisma schema validating.
2. Stand up auth, tenancy and RBAC.
3. Replace or port the 15 platform services listed above — most are generic
   (AI gateway, queue, crypto, storage, email), so porting is mechanical.
4. Decide the fate of the two WhatsApp endpoints.
5. Register the 4 background workers.
6. Add env config, build and CI.

`docs/GMB_EXTRACTION_ANALYSIS.md` has the measured coupling data behind all of
this, including per-portal state and the gotchas worth knowing before you start.

## Status of the portals

- **User / business panel** — complete (12 pages, all wired).
- **SuperAdmin** — partial; only scattered infrastructure config exists, no
  consolidated cross-tenant GMB view.
- **Partner / white-label** — does not exist. Partners can be *granted* the
  `local_seo` product, but there is no partner-facing GMB UI.

## Licence / provenance

Extracted from a private monorepo. Commit history was not carried over, so
`git blame` here will show a single import commit rather than real authorship.
