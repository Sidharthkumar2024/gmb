# UI source of truth and implementation rules

## Binding sources

The following user-supplied DesignCode HTML files are the immutable visual references. Their screen composition, hierarchy, dimensions, spacing, typography, colors, border radii, navigation grouping/order, labels, control placement, responsive behavior, and interaction states must be reproduced without creative deviation.

| Surface | Canonical file | SHA-256 |
| --- | --- | --- |
| Super Admin | `/Users/sidharthkumar/Desktop/WhatsApp API repository (1)/Adgrowly GMB Admin.dc.html` | `935d413e72c86b22317f92541b70beb4209b1e7593c02b05ba48099652c7b4ee` |
| Agencies marketing | `/Users/sidharthkumar/Desktop/WhatsApp API repository (1)/Adgrowly GMB Agencies.dc.html` | `847b35422368448bb068ee95918e83b15ccc48b9eadace0211b8b7f184cfb635` |
| Features marketing | `/Users/sidharthkumar/Desktop/WhatsApp API repository (1)/Adgrowly GMB Features.dc.html` | `1f210081a741bd07d3a4cab90a1f6ff954dd3e10154c13eff580873f9ba26651` |
| Landing marketing | `/Users/sidharthkumar/Desktop/WhatsApp API repository (1)/Adgrowly GMB Landing.dc.html` | `2e50979c3ea2946e367373d4a76f9f0750a1e78eb14f4e174768c47463c36827` |
| Pricing marketing | `/Users/sidharthkumar/Desktop/WhatsApp API repository (1)/Adgrowly GMB Pricing.dc.html` | `26c9edf08c6457a7053d405d565e385a2b29aa26736a2756414d4d7b58b16541` |
| Customer GMB Suite | `/Users/sidharthkumar/Desktop/WhatsApp API repository (1)/Adgrowly GMB Suite.dc.html` | `412ab857fb791d8341a821613d59f4a9c56d5aec6b626b9a74d7104359ac84ca` |
| Partner Portal | `/Users/sidharthkumar/Desktop/WhatsApp API repository (1)/Adgrowly Partner Portal.dc.html` | `fd995d96983ee8738269ffda068250cb3f8dafd06f5a3912c7eb9b0fce7a52d7` |

If a file's hash changes, stop and re-audit it before coding. Do not silently use the older copies in the repository root.

## Non-negotiable product override

This repository is exclusively a Google Business Profile / GMB product. WhatsApp has no role in it. Some supplied mockups contain legacy WhatsApp copy from an earlier combined product; treat only those fragments as stale content and replace them with the equivalent GMB concept while preserving the surrounding layout. Never add WhatsApp APIs, BSP configuration, numbers, message quotas, inboxes, chatbot features, review-request channels, navigation, database fields, environment variables, or dependencies.

Examples:

- A product selector containing “WhatsApp Business Panel” becomes a single GMB Suite preview without changing the preview card's geometry.
- Plan features about WhatsApp numbers/messages become GMB location, keyword, scan, report, review, and AI-credit entitlements backed by the real plan model.
- A WhatsApp review-request channel is omitted; existing GMB review-link/QR, email, or supported Google flows are used instead.

## Implementation rules

1. Reproduce the reference, do not redesign it. Do not move controls, rename sections, collapse screens, merge navigation items, change typography, introduce a different component library, or add decorative content that is not in the source.
2. A mock interaction is not a backend. Every visible save, create, update, delete, test, send, refund, publish, export, retry, or toggle must call a tenant-scoped API and persist or perform the stated action. If an external provider is unavailable, fail closed and show the real unconfigured/error state.
3. Never hard-code demo businesses, fake revenue, fake ranking movement, fake provider health, fake credits, fake commissions, fake delivery success, or fake security status. Read real records and show an honest empty/unavailable state when none exist.
4. Preserve security boundaries server-side. Customer routes are tenant-scoped, partner routes see only the partner and its child tenants, and admin routes require `SUPER_ADMIN`. Client redirects are UX only, never authorization.
5. Secrets are encrypted in the Secret Vault and returned only as safe metadata/last four characters. Provider test buttons perform a real test and report its real result.
6. Financial values come from `Payment`, `Invoice`, `PartnerInvoice`, `PartnerPlan`, and the idempotent wallet ledger. Never sum unlike currencies or infer captured money from UI state.
7. Keep App Router boundaries explicit. Use `next/link` for internal navigation, keep interactive pages/client hooks behind `"use client"`, avoid client/server waterfalls, and keep independent API reads parallel.
8. Keep accessibility behavior even where DesignCode does not model it: semantic buttons/links, associated labels, keyboard operation, visible focus, `aria-current`, honest disabled states, and no color-only status.
9. Work and deliver directly on `main`. Do not leave implementation on another branch.

## Canonical portal navigation

Customer Suite:

- Overview: Dashboard, Advisor
- Visibility: Rank tracker, Insights, Citations
- Engage: Reputation, Q&A, Posts
- Support: My tickets
- Grow: Go white-label, Review link & QR
- Profile: Locations, Place actions, Verifications, Images, Reports, Billing & plan, Settings

Super Admin:

- Platform: Overview, Accounts, White-label, Users & AI, Roles & access, Scan queue
- Billing: Plans & units, Payments, Invoices, Transactions
- Infrastructure: Google APIs, Image storage, AI models, API keys
- System: Providers & keys, Audit log, Health
- Email: Templates, SMTP & delivery
- Support: Tickets

Partner Portal:

- Dashboard, Customers, Branding, Plans & pricing, Commissions, Transactions, Invoices, Payment gateways, SMTP & email, Team & roles, Google API, Tickets, Email templates, Reports, Audit logs, Security

## Required verification before delivery

1. Confirm `git branch --show-current` is `main` and inspect `git status` before editing.
2. Run API typecheck and the complete test suite.
3. Run web typecheck, lint, and a production build.
4. Render changed routes at the same viewport as the DesignCode source and compare screenshots for geometry, spacing, typography, colors, states, and responsive overflow.
5. Exercise every changed mutation through browser → API → database/provider response. Verify cross-tenant access is rejected.
6. Search changed code and user-facing strings for prohibited legacy product terms and fabricated fixture values; only this contract may mention those terms to prohibit them.
7. Commit and push the verified result directly to `main`.
