# SRAtix Project Handoff — Session 2 (February 17, 2026)

## Session Summary

Continued Phase 1 implementation from Session 1. Completed all remaining Phase 1 server features and scaffolded both WordPress plugins.

## What Was Done

### 1. Cleanup (from Session 1 TODO list)

- **Removed diagnostic logging** from `Server/src/main.ts` — stripped 5 `console.log` statements and the route-table dumper. Kept only the clean NestJS Logger output.
- **Deleted `Tester/` directory** — hosting capability tests all passed; no longer needed.

### 2. Stripe Checkout Integration (`Server/src/payments/`)

Full Stripe Checkout (hosted) integration following PRODUCTION-ARCHITECTURE.md §9:

| File | Purpose |
|------|---------|
| `payments.module.ts` | Module wiring — imports OrdersModule, exports StripeService |
| `stripe.service.ts` | Stripe SDK wrapper — Checkout session creation, session retrieval, refunds, webhook event construction |
| `payments.controller.ts` | `POST /api/payments/checkout` — creates Checkout session for an order; `GET /api/payments/status/:orderId` — payment status check; `POST /api/payments/refund` — refund via payment intent |
| `stripe-webhook.controller.ts` | `POST /webhooks/stripe` — Stripe webhook handler (excluded from `/api` prefix); handles `checkout.session.completed`, `checkout.session.expired`, `charge.refunded` |

**Key decisions:**
- Stripe Checkout (hosted page) for Phase 1 — SAQ-A PCI compliance, server never touches card data
- Raw body enabled on FastifyAdapter (`rawBody: true`) for Stripe signature verification
- Webhook endpoint excluded from `/api` prefix AND auth guards — Stripe verifies via signature
- Orders service extended with `updateStripeSession()`, `markPaid()`, `findByStripePaymentId()`
- Added `stripe` ^17.0.0 to Server dependencies

**Env vars added to `.env`:**
```
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_PUBLISHABLE_KEY=pk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
STRIPE_MODE=test
```

### 3. SSE Real-Time Streams (`Server/src/sse/`)

Server-Sent Events implementation following PRODUCTION-ARCHITECTURE.md §13:

| File | Purpose |
|------|---------|
| `sse.module.ts` | Module wiring |
| `sse.service.ts` | In-process event bus using RxJS Subject — `emit()`, `subscribe()`, `subscribeAll()`, plus typed convenience emitters for check-ins, stats, orders, alerts |
| `sse.controller.ts` | SSE endpoints: `GET /api/sse/events/:eventId` (unified), `…/check-ins`, `…/stats`, `…/orders`, `…/alerts`, plus `GET /api/sse/events/heartbeat` (30s keepalive) |

**Key decisions:**
- In-process RxJS Subject (not Redis Pub/Sub) for Phase 1 — single-process deployment
- Upgrade path: swap `bus$` to Redis Pub/Sub when moving to multi-process
- Each stream filtered by `eventId` + `channel`
- Heartbeat stream keeps connections alive through Infomaniak proxy
- Role-scoped: check-in feed allows gate_staff/scanner, stats restricted to event_admin/super_admin

### 4. SRAtix Control WP Plugin (`sratix-control/`)

Thin WP connector for swiss-robotics.org — follows standard SRA plugin architecture:

```
sratix-control/
├── sratix-control.php              # Main bootstrap, activation (creates wp_sratix_mappings table)
├── admin/css/admin.css              # Admin styles
└── includes/
    ├── class-sratix-control-loader.php    # Standard hook loader
    ├── class-sratix-control.php           # Core orchestrator
    ├── class-sratix-control-admin.php     # Settings page (API URL, secrets, connection test, dashboard link)
    ├── class-sratix-control-api.php       # API client — HMAC token exchange + authenticated HTTP requests
    ├── class-sratix-control-sync.php      # Sync handler — pushes profile_update, role_change, group_join/leave, WooCommerce orders
    └── class-sratix-control-webhook.php   # Webhook receiver at /wp-json/sratix/v1/webhook — handles registration.confirmed, attendee.updated, order.paid, entity.create_request
```

**Features:**
- HMAC-SHA256 token exchange matching Server's auth flow
- Automated `wp_sratix_mappings` table creation on activation
- Real-time sync hooks: `profile_update`, `set_user_role`, `pm_after_join_group`, `pm_after_leave_group`, `woocommerce_order_status_completed`
- Health check on settings page (pings Server's `/health` endpoint)
- Dashboard quick-link to SRAtix Server UI

### 5. SRAtix Client WP Plugin (`sratix-client/`)

Thin WP connector for swissroboticsday.ch — public ticket purchase:

```
sratix-client/
├── sratix-client.php               # Main bootstrap, activation
├── public/
│   ├── css/sratix-client.css        # Responsive ticket cards, badges, messages
│   └── js/sratix-embed.js           # Widget initializer — fetches ticket types, renders cards
└── includes/
    ├── class-sratix-client-loader.php     # Standard hook loader
    ├── class-sratix-client.php            # Core orchestrator
    ├── class-sratix-client-admin.php      # Settings page (API URL, event ID, embed config)
    ├── class-sratix-client-public.php     # Shortcodes: [sratix_tickets], [sratix_my_tickets], [sratix_schedule]
    └── class-sratix-client-webhook.php    # Webhook receiver at /wp-json/sratix-client/v1/webhook
```

**Shortcodes:**
| Shortcode | Description |
|-----------|-------------|
| `[sratix_tickets]` | Ticket type cards with price, description, select button |
| `[sratix_my_tickets]` | Logged-in attendee self-service (view purchased tickets) |
| `[sratix_schedule]` | Event schedule / sessions grid |

**Key decisions:**
- JS widget injection pattern (same as `sra-member-badges` embed)
- Assets loaded conditionally — only on pages containing SRAtix shortcodes
- Config passed via `wp_localize_script` as `sratixConfig`
- CSS uses CSS custom properties for theming (`--sratix-primary`)

### 6. Updated Server Config

- `app.module.ts` — imports `PaymentsModule` and `SseModule`
- `main.ts` — `rawBody: true` on NestFactory, `webhooks/stripe` excluded from `/api` prefix
- `.env` — Stripe env vars added
- `package.json` — `stripe` ^17.0.0 added to dependencies

## Current Workspace Structure

```
SRAtix/
├── package.json
├── .gitignore
├── README.md
├── Docs/
│   ├── PRODUCTION-ARCHITECTURE.md
│   ├── HANDOFF-SESSION-1.md
│   └── HANDOFF-SESSION-2.md          ← NEW
├── Server/
│   ├── package.json                   # +stripe dependency
│   ├── .env                           # +Stripe env vars
│   ├── prisma/schema.prisma
│   └── src/
│       ├── main.ts                    # Cleaned up, rawBody enabled
│       ├── app.module.ts              # +PaymentsModule, +SseModule
│       ├── prisma/
│       ├── auth/
│       ├── health/
│       ├── events/
│       ├── ticket-types/
│       ├── orders/                    # Extended with Stripe methods
│       ├── attendees/
│       ├── payments/                  ← NEW (3 files)
│       └── sse/                       ← NEW (3 files)
├── sratix-control/                    ← NEW (7 files)
│   ├── sratix-control.php
│   ├── admin/css/admin.css
│   └── includes/
└── sratix-client/                     ← NEW (8 files)
    ├── sratix-client.php
    ├── public/css/sratix-client.css
    ├── public/js/sratix-embed.js
    └── includes/
```

## Deployment Notes

**Before deploying Session 2 changes:**

1. Replace Stripe test keys in `.env` with actual test keys from [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys)
2. Set up a Stripe webhook endpoint pointing to `https://tix.swiss-robotics.org/webhooks/stripe` with events: `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`
3. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET` in `.env`
4. Run `npm install` in Server/ to install the `stripe` package

**Build command** (standard):
```
git pull origin main && npm install && npm run build
```

**WP plugins:**
- Copy `sratix-control/` to `wp-content/plugins/sratix-control/` on swiss-robotics.org
- Copy `sratix-client/` to `wp-content/plugins/sratix-client/` on swissroboticsday.ch
- Activate and configure API URL + secrets in each plugin's settings page

## What's Next (Phase 2)

1. **Public ticket types endpoint** — `GET /api/events/:id/ticket-types/public` (unauthenticated, for Client widget)
2. **Ticket issuance** — Create `Ticket` records when order is paid (in webhook handler)
3. **Email confirmation** — BullMQ job queue for sending order confirmation emails
4. **Check-in module** — `POST /api/check-ins` with QR code validation
5. **Badge template system** — satori-based JSON layout rendering
6. **Control dashboard enhancement** — iframe the Server dashboard with SSO
7. **Client registration form** — Server-rendered form embedded in Client widget
8. **Visual form builder** — Dashboard UI for defining registration form schemas
9. **Stripe live mode** — swap to production keys, test end-to-end flow
10. **Audit logging** — populate `audit_log` table on key actions

## Technical Debt / TODOs

- `stripe-webhook.controller.ts` — TODO: issue tickets on payment, send confirmation email, fire webhook to sratix-control/sratix-client
- `auth.service.ts` — TODO: implement `wp_mappings` lookup and proper user creation on first token exchange
- `sse.service.ts` — upgrade to Redis Pub/Sub for multi-process deployments
- `payments.controller.ts` — ticket type names in line items are currently IDs; resolve to names via service
- Client `sratix-embed.js` — ticket selection click handler shows alert placeholder; needs registration form modal
