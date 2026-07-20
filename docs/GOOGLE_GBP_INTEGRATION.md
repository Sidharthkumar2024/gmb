# Google Business Profile Integration — Setup Runbook + Status

AdGrowly's GMB Suite talks to Google's federated Business Profile API family.
Every customer connects **their own** Google account via OAuth — we never hold
Google passwords, and we only manage locations the customer owns or has been
explicitly granted. This doc is the operator runbook (the Google Cloud steps a
SuperAdmin performs) plus an honest map of spec → what the codebase already
implements → what is Phase 2.

---

## 1. Implementation status matrix

| Spec area | Status | Where in the code |
|---|---|---|
| OAuth 2.0 (`business.manage`, offline access, signed state) | ✅ built | `gmbGoogle.service.ts` (`buildGoogleBusinessProfileOAuthUrl`, `exchangeGoogleOAuthCode`, `signGoogleOAuthState`) |
| Encrypted token storage | ✅ built | credential payload envelope-encrypted via `tokenCrypto` (`storeGoogleCredential`), masked last4 only |
| SuperAdmin OAuth config (client id/secret, redirect, scope, enable) | ✅ built | `GoogleOAuthConfig` model + `googleOAuthConfig.service.ts` + `/google-config` admin page (secret encrypted, masked on read) |
| Account Management API (accounts list) | ✅ built | `syncGoogleLocations` walks accounts → locations |
| Business Information API (locations, categories, address) | ✅ built | `GmbLocation` sync + `gmbLocation.service.ts` |
| Reviews: list/sync, reply create/update | ✅ built | `syncGoogleReviewsForLocation`, `updateGoogleReviewReply`; AI drafts + approval flow on `/gmb-reputation` |
| Review auto-reply default OFF, approval-first | ✅ built | autopilot config defaults; drafts require approval |
| Google Posts (update/event/offer/CTA) | ✅ built | `createGoogleLocalPost` + approve → BullMQ publish pipeline (`gmbPostPublisher`) |
| Performance API (impressions, calls, clicks, directions) | ✅ built | `syncGoogleInsightsForLocation` → `GmbInsightSnapshot` |
| Auto-sync worker (cadence, per-location isolation) | ✅ built | `gmbAutoSync.service.ts`, 6h default, stalest-first, dedicated queue |
| **Quota pacing: spacing + 429 backoff + sweep abort** | ✅ built (this change) | `gmbAutoSync.service.ts` — `isQuotaError`, `computeQuotaBackoffMs`, paced sweep |
| Disconnect (revoke + stop jobs) | ✅ built | `disconnectGoogleBusinessProfile` |
| Google API call logging | ✅ built | `GoogleApiLog` model (every call via `googleJson`) |
| Notifications API + Pub/Sub (event-driven reviews) | ⏳ Phase 2 | polling covers it today (6h + manual sync) |
| Verifications API | ⏳ Phase 2 | must stay customer-initiated only (policy) |
| Place Actions API (booking/order links) | ⏳ Phase 2 | landing-page booking exists; GBP link sync pending |
| Q&A API | ⏳ Phase 2 | — |
| Lodging / Business Calls APIs | ⏳ Phase 2 (niche) | — |
| Mode B: partner-owned Google Cloud project | ⏳ Phase 2 | today: single platform project (Mode A) |

---

## 2. Google Cloud setup (SuperAdmin, one-time per environment)

Keep separate projects — never mix keys:

```
adgrowly-development · adgrowly-staging · adgrowly-production
```

### 2a. Apply for Business Profile API access

Enabling the APIs is not enough — if quotas show `0`, the project has not been
granted GBP access yet. Submit Google's **Application for Basic API Access**
stating that:

- AdGrowly is a local-business management SaaS;
- customers sign in with their own Google accounts (OAuth);
- we provide review replies, posts, profile optimization and reports;
- nothing is edited/replied/posted without customer consent (our defaults:
  auto-reply OFF, approval-first posting);
- Privacy Policy, Terms, Refund and data-deletion pages are live;
- a demo account is available for Google review.

### 2b. Enable APIs (Console → APIs & Services → Library)

Required: My Business Account Management, My Business Business Information,
Business Profile Performance, My Business Notifications, My Business
Verifications, My Business Place Actions, My Business Q&A, Google My Business
API (legacy v4.9 for reviews/posts), Cloud Pub/Sub.
Optional: Lodging, Business Calls, Maps Platform.

### 2c. OAuth consent screen

App name **AdGrowly**, support email, logo, homepage, privacy policy, terms,
data-deletion URL, authorized domain. What you enter here is exactly what the
customer sees on the consent screen.

### 2d. OAuth Client ID (Web application)

- JavaScript origins: `https://app.<domain>`, `https://admin.<domain>`
- Redirect URIs: `https://api.<domain>/api/google/oauth/callback` (staging too)
- Copy the **Client ID + Client Secret** into SuperAdmin → `/google-config`.
  The secret is envelope-encrypted at rest and only ever shown masked.

### 2e. Scope

```
https://www.googleapis.com/auth/business.manage
```
(the old `plus.business.manage` is deprecated). The code requests
`access_type=offline&prompt=consent` so approved background syncs keep working.

---

## 3. Customer connection flow (already implemented)

```
Customer Portal → Connect Google Business Profile
→ Google consent screen → grant
→ callback → backend exchanges code (exchangeGoogleOAuthCode)
→ tokens envelope-encrypted (storeGoogleCredential)
→ accounts + locations fetched (syncGoogleLocations)
→ customer selects locations → linked to tenantId
→ initial review + insights sync
```

One connection per customer. A single SuperAdmin token is **never** used for
all customers.

Disconnect (`disconnectGoogleBusinessProfile`) revokes the stored credential
and halts syncs. Per Google's third-party policy, disassociate an end-client
within seven business days of the relationship ending.

---

## 4. Quota & pacing model (implemented)

GBP APIs default to roughly **300 QPM**; bursts return `429 RESOURCE_EXHAUSTED`.
The auto-sync sweep therefore:

- processes locations **stalest-first**, capped per sweep;
- waits `GMB_AUTO_SYNC_LOCATION_SPACING_MS` (default 2 s) between locations;
- on a quota error, backs off exponentially with ±20 % jitter
  (`GMB_AUTO_SYNC_QUOTA_BACKOFF_BASE_MS` doubling to `..._CAP_MS`);
- **aborts the sweep** after `GMB_AUTO_SYNC_MAX_QUOTA_HITS` consecutive quota
  errors — deferred locations are first in line next sweep.

Cadence guidance: reviews 6–24 h polling (until Pub/Sub lands), profile
6–24 h, performance daily, posts via the exact scheduled queue.

---

## 5. Policy guardrails (already encoded in product behavior)

- Review auto-reply is **OFF by default**; replies and posts are draft → human
  approval. Google policy requires prior, specific, express consent for
  automated changes.
- Verification must only ever be **customer-initiated** (never background).
- Agencies/end-clients must not get unrestricted automated scripts through the
  platform project. When that need arrives, use **Mode B** (partner-owned
  Google Cloud project + credentials) — tracked as Phase 2.

---

## 6. Phase 2 backlog (tracked in TASKS.md)

1. **Notifications API + Pub/Sub consumer** — event-driven review sync
   (topic `projects/<project>/topics/gbp-notifications` → webhook/consumer →
   queue sync job). Replaces polling as the primary trigger; polling stays as
   fallback.
2. **Verifications API** — status + customer-initiated request UI.
3. **Place Actions API** — booking/appointment/order links synced from the
   existing landing-page booking.
4. **Q&A API** — questions inbox + AI-drafted answers (approval-first).
5. **Mode B** — partner-owned Google project credentials per partner.
6. Lodging / Business Calls for niche verticals.
