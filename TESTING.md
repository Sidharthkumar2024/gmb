# Testing conventions (apps/api)

How the API's unit tests are written, so new coverage stays consistent. The
suite runs with **vitest** from the repo root (`npx vitest run`); the config
includes `apps/api/src/**/*.test.ts`. Every test file sits next to the module
it covers (`foo.service.ts` → `foo.service.test.ts`).

## Principles

- **Test behaviour and invariants, not implementation.** Prefer asserting the
  observable contract (status codes, returned shape, what got persisted) over
  internal calls — except when the *call itself* is the security boundary
  (e.g. "the DB lookup is filtered by the caller's scope+tenant").
- **Name the invariant.** Each `describe`/`it` should read as the rule it
  protects: "fails closed when unauthenticated", "never leaks ciphertext",
  "releases the reservation when the provider throws".
- **Pure helpers get pure tests** (no mocks). Many services split out pure
  functions (`orderProviderChain`, `deriveConnectionState`, `normalizeHex`,
  `buildUploadKey`, `extractPlaceholders`) — test those directly first.

## Mocking Prisma while keeping the real enums

`@nexaflow/db` exports both the `prisma` client and the Prisma enums
(`SecretScope`, `TicketStatus`, …). Tests need the real enums but a fake
client. Use `importOriginal` and override only `prisma`:

```ts
const deps = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn() }));

vi.mock("@nexaflow/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nexaflow/db")>();
  return { ...actual, prisma: { someModel: { findFirst: deps.findFirst, create: deps.create } } };
});
```

- Put mock fns in `vi.hoisted(...)` so they exist before the hoisted
  `vi.mock` factory runs.
- `$transaction([...])` (array form): mock it to resolve; the op builders
  (`prisma.x.update(...)`) still run, so you can assert their call args.
- `afterEach(() => vi.clearAllMocks())` — and `vi.unstubAllEnvs()` if you
  stubbed env.

## Other collaborators

- Internal services: `vi.mock("./billing.service", () => ({ reserveAi: deps.reserveAi, ... }))`.
- Node built-ins / SDKs: `vi.mock("node:dns/promises", ...)`, and default
  exports as `vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: deps.create }; } }))`.
- **Environment:** `vi.stubEnv("KEY", "value")` (dotenv injects `.env`, so
  stub anything you assert on) and `vi.unstubAllEnvs()` in `afterEach`.
- **Injectable seams beat mocks.** Several functions take an optional `now`,
  `env`, or `client`/`config` for exactly this reason — pass a fixed value
  instead of mocking a global (`presignUpload({ now })`,
  `readPublicObjectStorageConfig(env)`, `putPublicObject(input, { client, config })`).

## Middleware

Middleware takes `(req, res, next)`. Build a minimal `req`, a `vi.fn()` `next`,
and assert on `next.mock.calls[0][0]` — an `ApiError` (check `.statusCode`) on
rejection, or `undefined` on a clean pass. See `middleware/auth.test.ts` /
`middleware/rbac.test.ts`.

## Security invariants worth a dedicated test

These recur across the codebase and each has an explicit test — copy the shape
when adding a similar surface:

- **Scope isolation** — a read/write is filtered by the caller's scope+tenant;
  a foreign id 404s (`secretVault`, `aiProviderHub`, `supportTicket`).
- **Identity from the DB, not the token** — `requireAuth` overrides a JWT's
  tenant/role claims with the DB row.
- **Secrets never leave** — masked (`last4`) DTOs; assert
  `JSON.stringify(dto)` does not contain the plaintext/ciphertext.
- **Fail closed** — missing auth/secret/config yields 4xx/`false`/`null`,
  never a silent allow.
- **Webhook trust boundary** — HMAC verify with a constant-time compare;
  wrong/absent signature or tampered body is rejected (`razorpay`, `stripe`).
- **Honest degradation** — an unconfigured provider throws a clean error or
  skips (email), never fabricates success.
- **Billing safety** — a provider failure releases the reservation and never
  bills; unconfigured throws *before* reserving (`ai.service`).

## What isn't unit-tested here

Full HTTP round-trips (router + middleware chain over a real request) would
need a harness like `supertest`; that isn't wired up yet, and `apps/api`'s
`index.ts` calls `app.listen()` on import, so an integration harness should
assemble a test-only Express app (mounting the target router + `errorHandler`)
rather than importing `index.ts`.
