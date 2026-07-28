# Adgrowly GMB Suite — Go-Live Checklist

Everything the code needs to run in production. Grounded in the actual
`process.env` keys the services read and the actual route paths — not a generic
template. Copy `.env.example` to `.env` and fill it as you go.

## 0. Prerequisites

- **Postgres** — set `DATABASE_URL`. Apply migrations: `npm run db:deploy`
  (root; runs `prisma migrate deploy`).
- **Redis** — set `REDIS_URL` (BullMQ workers + rate limiting use it).
- **Seed** (first deploy only) — `npm run db:seed` creates the super
  admin + demo data. Override the seed accounts with `SEED_SUPER_EMAIL` /
  `SEED_SUPER_PASSWORD` (and `SEED_EMAIL`/`SEED_PASSWORD`,
  `SEED_PARTNER_EMAIL`/`SEED_PARTNER_PASSWORD`) **before** seeding, or change the
  passwords immediately after.

## 1. Core secrets (required — the app refuses to start on placeholders)

- `JWT_SECRET` — long random string (≥16 chars, not starting with `change_me`).
  Signs every access token, **including impersonation tokens**.
- `TENANT_TOKEN_ENCRYPTION_KEY` — 32-byte base64 key. Encrypts every Secret Vault
  entry (Google tokens, AI keys, SMTP, **partner gateway keys**). Losing/rotating
  this makes stored secrets unreadable.
- `WEB_URL` — public URL of the web app (used in invite/receipt links + Stripe
  return URLs). `API_PORT` — API listen port.

## 2. Payment gateways (Razorpay and/or Stripe)

Keys live in **env** (safest for payment secrets); the super admin picks the
**active** provider at `/admin/gateways`. Configure either or both.

**Razorpay:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
`RAZORPAY_CREDIT_PRICE_PAISA` (100 = ₹1/credit).
**Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_CREDIT_PRICE_CENTS` (1 = $0.01/credit).

**Webhook URLs to register in each gateway dashboard** (these are public and must
stay ahead of auth — they already are):

| Purpose | URL |
|---|---|
| Platform Razorpay | `https://<api-host>/api/v1/billing/webhook/razorpay` |
| Platform Stripe | `https://<api-host>/api/v1/billing/webhook/stripe` |
| Per-partner Razorpay | `https://<api-host>/api/v1/billing/webhook/razorpay/<partnerTenantId>` |
| Per-partner Stripe | `https://<api-host>/api/v1/billing/webhook/stripe/<partnerTenantId>` |

The webhook verifies the HMAC against the raw body, then credits via
`grantCredits` (idempotent on the payment id) — a redelivered webhook never
double-credits. **Partner-routed charging:** a white-label partner adds its own
keys + webhook secret at `/partner/gateway`; that screen shows the exact
per-partner URL to paste into the partner's own gateway dashboard.

**Verify:** send a test `payment.captured`; the wallet credits once, a `Payment`
row appears in `/admin/payments`, and a replay leaves the balance unchanged.

## 3. AI (Anthropic)

- `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`). Also settable by the admin
  at `/admin/ai`. Without it, AI features **degrade to deterministic templates**
  rather than failing — safe to launch without, but review replies / captions /
  advisor are template-quality until set.
- `WALLET_BILLING_ENABLED` — **off by default = AI runs free.** Set `true` to make
  AI features actually spend credits (reserve/settle, blocked when the balance
  can't cover). Top-ups credit regardless of this flag.

## 4. Google (Business Profile + Places)

- OAuth client: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_OAUTH_REDIRECT_URI` (must match an Authorized Redirect URI on the
  client; enable the "Google Business Profile API"). Admin can also set these at
  `/admin/google`.
- `GOOGLE_PLACES_API_KEY` — powers the rank grid / leaderboard.
- ⚠️ **Rotate the Google client secret that was exposed earlier in development
  before launch.** Generate a fresh secret in Google Cloud Console, update the
  env (or `/admin/google`), and invalidate the old one.

## 5. Email (SMTP)

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`,
  `SMTP_FROM_NAME`. Also settable at `/admin/email`.
- Without SMTP, auth / invite / receipt emails are **skipped, never silently
  "sent"** — the UI reports `emailSent: false` and shows the invite link to copy
  manually. Templates are editable at `/admin/email-templates`.

## 6. Object storage (S3 / R2)

- Configured by the super admin at `/admin/storage` (bucket/region/keys stored in
  the vault), not via env. Needed for real image uploads (branding logo, GMB post
  images); until set, those fields accept URLs.

## 7. Workers

- `ENABLE_WORKERS=true` — runs the schedulers: GMB auto-sync, autopilot, post
  publisher, scheduled reports, and **monthly partner-invoice finalisation**. Off
  by default. Run on at least one instance. Intervals are tunable via the
  `*_INTERVAL_MS` vars (sane defaults otherwise).

## 8. Launch verification

- [ ] `npm run db:deploy` clean; app boots (no placeholder-secret error).
- [ ] Log in as the super admin; change the seeded password.
- [ ] `/admin/gateways` shows the intended active provider as **Configured**.
- [ ] A real (or test-mode) top-up credits the wallet; `/admin/payments` shows it;
      the customer sees a **receipt** at `/gmb-billing`.
- [ ] A refund from `/admin/payments` flips the payment to REFUNDED and reverses
      the credits (then issue the money-back in the gateway dashboard).
- [ ] Partner flow: onboard a customer at `/partner`, set a resale plan, connect
      the partner gateway + webhook, confirm a child top-up routes to the partner.
- [ ] SMTP: trigger a password reset; confirm the email arrives.
- [ ] Google: connect a Business Profile; the rank grid populates.
- [ ] Workers on: a scheduled report / partner invoice finalises on cadence.
- [ ] Rotate the exposed Google secret (§4).

## Security notes

- Never commit `.env`. Gateway/AI/JWT secrets live in env or the vault; only the
  active-provider choice and last-4 masks are ever exposed to the browser.
- Impersonation (`/admin` → "View as") mints a 30-min, non-refreshable token and
  is audit-logged (`IMPERSONATE`).
- The credit ledger (`WalletTransaction`) is the source of truth:
  `SUM(deltaCredits) per wallet == balance`. Everything that moves credits
  (grant, refund) is idempotency-keyed.
