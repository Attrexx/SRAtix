# SRAtix — Session 3 Handoff

**Date**: 2026-01-XX  
**Session Focus**: Phase 1 completion — Tickets, Check-In, Audit Logging, Email scaffold  
**Server Source Files**: 46 TypeScript files (up from 33 in Session 2)

---

## What Was Done

### 1. Public Ticket Types Endpoint
- **New file**: `Server/src/ticket-types/ticket-types-public.controller.ts`
- Route: `GET /api/events/:eventId/ticket-types/public` (unauthenticated)
- Added `findPublicByEvent()` to `TicketTypesService` — filters active types within sales window, calculates availability, marks sold-out
- Registered `TicketTypesPublicController` in `TicketTypesModule`
- Used by the Client widget embed so visitors can browse tickets without logging in

### 2. Tickets Module (Issuance + QR Codes)
- **New files**: `Server/src/tickets/tickets.module.ts`, `tickets.service.ts`, `tickets.controller.ts`
- Ticket code: 12-char uppercase alphanumeric (72 bits entropy from `randomBytes`)
- QR payload: `{code}:{hmac}` where HMAC = HMAC-SHA256(code, JWT_SECRET + eventId) truncated to 16 hex chars
- `verifyQrPayload()` — constant-time comparison to prevent timing attacks
- `issueForOrder(orderId)` — creates one Ticket record per OrderItem quantity unit
- `void(id, eventId)` / `voidByOrder(orderId)` — void individual or all tickets for an order
- `markCheckedIn(id)` — sets status to 'used' and checkedInAt timestamp
- Controller endpoints:
  - `GET /api/events/:eventId/tickets` — list all tickets (event_admin, super_admin, staff)
  - `GET /api/events/:eventId/tickets/:id` — detail + QR payload
  - `PATCH /api/events/:eventId/tickets/:id/void` — void a ticket

### 3. Ticket Issuance Wired into Stripe Webhook
- Updated `stripe-webhook.controller.ts` to inject `TicketsService` and `SseService`
- On `checkout.session.completed`: issues tickets, emits SSE order event
- On `charge.refunded`: voids all tickets for the refunded order
- TODOs reduced to: email confirmation (deferred to BullMQ), webhook to WP plugins

### 4. Check-In Module
- **New files**: `Server/src/check-ins/check-ins.module.ts`, `check-ins.service.ts`, `check-ins.controller.ts`
- Full QR-based check-in flow:
  1. Parse QR payload → verify HMAC signature (offline-capable pattern)
  2. Look up ticket by code
  3. Validate ticket status + event scope
  4. Check duplicate rules (re-entry allowed but flagged)
  5. Create CheckIn record
  6. Update ticket status to 'used' on first check-in
  7. Emit SSE check-in event for live dashboard
  8. Write audit log entry
- Offline sync: `syncOfflineBatch()` — first-check-in-wins conflict resolution
- Statistics: `getStats()` — totalTickets, checkedIn, percentCheckedIn
- Controller endpoints:
  - `POST /api/events/:eventId/check-ins` — process a single check-in
  - `POST /api/events/:eventId/check-ins/sync` — sync offline batch
  - `GET /api/events/:eventId/check-ins` — list recent check-ins
  - `GET /api/events/:eventId/check-ins/stats` — check-in statistics
- Role access: event_admin, super_admin, staff, gate_staff, scanner

### 5. Audit Log Service
- **New files**: `Server/src/audit-log/audit-log.module.ts`, `audit-log.service.ts`
- `@Global()` module — available everywhere without explicit imports
- Fire-and-forget: failures logged but never propagated to caller
- Standardized `AuditAction` constants for all entity types
- `log()` — single entry, `logBatch()` — batch insert via `createMany()`
- Query methods: `findByEvent()`, `findByEntity()` for dashboard
- Wired into:
  - **OrdersService**: order.created, order.paid
  - **TicketsService**: ticket.issued (batch), ticket.voided
  - **CheckInsService**: check_in.recorded, check_in.duplicate

### 6. Email Module (Transport Abstraction + SMTP)
- **New files**: `Server/src/email/email.module.ts`, `email.service.ts`, `email-transport.interface.ts`, `transports/smtp.transport.ts`
- `EmailTransport` interface — abstracted from day 1 per architecture doc
- `SmtpTransport` — nodemailer-based, falls back to console logging when SMTP_HOST is empty (dev mode)
- `EmailService`:
  - `sendOrderConfirmation()` — HTML + plain text templates with order summary, ticket list, event details
  - `sendNotification()` — generic subject/html emails
- Dependencies added: `nodemailer ^7.0.0`, `@types/nodemailer ^6.4.0`
- SMTP env vars added to `.env`: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM

### 7. Module Registration
- Updated `app.module.ts` to import: `TicketsModule`, `CheckInsModule`, `AuditLogModule` (Global), `EmailModule`
- Updated `PaymentsModule` to import: `TicketsModule`, `SseModule`
- Updated `CheckInsModule` to import: `TicketsModule`, `SseModule`

---

## Files Created (13 new)

| File | Purpose |
|------|---------|
| `Server/src/ticket-types/ticket-types-public.controller.ts` | Unauthenticated ticket types endpoint |
| `Server/src/tickets/tickets.module.ts` | Tickets module |
| `Server/src/tickets/tickets.service.ts` | Ticket issuance, QR codes, HMAC, management |
| `Server/src/tickets/tickets.controller.ts` | Ticket REST endpoints |
| `Server/src/check-ins/check-ins.module.ts` | Check-in module |
| `Server/src/check-ins/check-ins.service.ts` | QR validation, check-in recording, offline sync |
| `Server/src/check-ins/check-ins.controller.ts` | Check-in REST endpoints |
| `Server/src/audit-log/audit-log.module.ts` | Global audit log module |
| `Server/src/audit-log/audit-log.service.ts` | Audit trail service |
| `Server/src/email/email.module.ts` | Email module |
| `Server/src/email/email.service.ts` | Email sending + templates |
| `Server/src/email/email-transport.interface.ts` | Transport abstraction interface |
| `Server/src/email/transports/smtp.transport.ts` | SMTP transport (nodemailer) |

## Files Modified (8)

| File | Changes |
|------|---------|
| `Server/src/app.module.ts` | Added 4 new module imports |
| `Server/src/ticket-types/ticket-types.module.ts` | Added TicketTypesPublicController |
| `Server/src/ticket-types/ticket-types.service.ts` | Added `findPublicByEvent()` |
| `Server/src/payments/payments.module.ts` | Added TicketsModule + SseModule imports |
| `Server/src/payments/stripe-webhook.controller.ts` | Wired ticket issuance + SSE + void on refund |
| `Server/src/orders/orders.service.ts` | Added AuditLogService injection + audit calls |
| `Server/package.json` | Added nodemailer + @types/nodemailer |
| `Server/.env` | Added SMTP_* env vars |

---

## Current Server Architecture

```
Server/src/
├── main.ts                              # Bootstrap (Fastify, CORS, global prefix)
├── app.module.ts                        # Root module (14 imports)
├── prisma/                              # Database (2 files)
│   ├── prisma.module.ts
│   └── prisma.service.ts
├── auth/                                # JWT auth + RBAC (7 files)
│   ├── auth.module.ts
│   ├── auth.service.ts
│   ├── auth.controller.ts
│   ├── strategies/jwt.strategy.ts
│   ├── guards/roles.guard.ts
│   └── decorators/{roles,current-user}.decorator.ts
├── health/                              # Health check (2 files)
├── events/                              # Event CRUD (4 files)
├── ticket-types/                        # Ticket type CRUD + public (4 files)
│   ├── ticket-types.module.ts
│   ├── ticket-types.service.ts
│   ├── ticket-types.controller.ts       # Authenticated
│   └── ticket-types-public.controller.ts  ← NEW (unauthenticated)
├── orders/                              # Order management (3 files)
├── attendees/                           # Attendee CRUD (3 files)
├── tickets/                             ← NEW (3 files)
│   ├── tickets.module.ts
│   ├── tickets.service.ts               # QR codes, HMAC, issuance
│   └── tickets.controller.ts
├── check-ins/                           ← NEW (3 files)
│   ├── check-ins.module.ts
│   ├── check-ins.service.ts             # QR validation, offline sync
│   └── check-ins.controller.ts
├── payments/                            # Stripe Checkout (4 files)
│   ├── payments.module.ts
│   ├── stripe.service.ts
│   ├── payments.controller.ts
│   └── stripe-webhook.controller.ts     # Issues tickets on payment
├── audit-log/                           ← NEW (2 files)
│   ├── audit-log.module.ts              # @Global
│   └── audit-log.service.ts
├── email/                               ← NEW (4 files)
│   ├── email.module.ts
│   ├── email.service.ts
│   ├── email-transport.interface.ts
│   └── transports/smtp.transport.ts
└── sse/                                 # Real-time SSE (3 files)
```

**Total**: 46 TypeScript source files + schema.prisma + package.json

---

## API Endpoints (Complete)

### Unauthenticated
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | Server info |
| GET | `/health` | Health check |
| POST | `/webhooks/stripe` | Stripe webhook handler |
| GET | `/api/events/:eventId/ticket-types/public` | Public ticket types |

### Authenticated (JWT + RBAC)
| Method | Route | Roles | Purpose |
|--------|-------|-------|---------|
| POST | `/api/auth/wp-token-exchange` | — | WP token exchange |
| POST | `/api/auth/refresh` | — | Refresh JWT |
| GET | `/api/events` | event_admin, super_admin | List events |
| GET | `/api/events/:id` | event_admin, super_admin | Get event |
| POST | `/api/events` | super_admin | Create event |
| PATCH | `/api/events/:id` | event_admin, super_admin | Update event |
| GET | `/api/events/:eventId/ticket-types` | event_admin, super_admin | List ticket types |
| GET | `/api/events/:eventId/ticket-types/:id` | event_admin, super_admin | Get ticket type |
| POST | `/api/events/:eventId/ticket-types` | event_admin, super_admin | Create ticket type |
| PATCH | `/api/events/:eventId/ticket-types/:id` | event_admin, super_admin | Update ticket type |
| GET | `/api/events/:eventId/orders` | event_admin, super_admin | List orders |
| GET | `/api/orders/:id` | event_admin, super_admin | Get order |
| POST | `/api/events/:eventId/orders` | event_admin, super_admin | Create order |
| PATCH | `/api/orders/:id/status` | event_admin, super_admin | Update status |
| GET | `/api/events/:eventId/attendees` | event_admin, super_admin | List attendees |
| GET | `/api/attendees/:id` | event_admin, super_admin | Get attendee |
| POST | `/api/events/:eventId/attendees` | event_admin, super_admin | Create attendee |
| PATCH | `/api/attendees/:id` | event_admin, super_admin | Update attendee |
| GET | `/api/events/:eventId/tickets` | event_admin, super_admin, staff | List tickets |
| GET | `/api/events/:eventId/tickets/:id` | event_admin, super_admin, staff | Get ticket + QR |
| PATCH | `/api/events/:eventId/tickets/:id/void` | event_admin, super_admin | Void ticket |
| POST | `/api/events/:eventId/check-ins` | event_admin, …, scanner | Process check-in |
| POST | `/api/events/:eventId/check-ins/sync` | event_admin, …, scanner | Sync offline batch |
| GET | `/api/events/:eventId/check-ins` | event_admin, super_admin, staff | List check-ins |
| GET | `/api/events/:eventId/check-ins/stats` | event_admin, super_admin, staff | Check-in stats |
| POST | `/api/payments/checkout` | event_admin, super_admin | Create Stripe session |
| GET | `/api/payments/status/:orderId` | event_admin, super_admin | Check payment status |
| POST | `/api/payments/refund` | event_admin, super_admin | Process refund |
| SSE | `/api/sse/events/:eventId` | event_admin, super_admin, staff | Unified SSE stream |
| SSE | `/api/sse/events/:eventId/check-ins` | …, gate_staff, scanner | Check-in feed |
| SSE | `/api/sse/events/:eventId/stats` | event_admin, super_admin | Stats stream |
| SSE | `/api/sse/events/:eventId/orders` | …, box_office | Order stream |
| SSE | `/api/sse/events/:eventId/alerts` | event_admin, super_admin, staff | Alerts stream |
| SSE | `/api/sse/events/heartbeat` | — | 30s heartbeat |

---

## Deployment Notes

**Before deploying Session 3 changes:**

1. Run `npm install` in Server/ to install `nodemailer` and `@types/nodemailer`
2. Configure SMTP settings in `.env` (or leave empty for dev mode logging)
3. Build: `npm run build`
4. Standard deploy: `git pull origin main && npm install && npm run build`

---

## Phase 1 Build Plan — Updated Status

| Item | Status | Session |
|------|--------|---------|
| Event creation & configuration (CRUD) | ✅ Done | 1 |
| Ticket type definitions | ✅ Done | 1 |
| Stripe Checkout integration | ✅ Done | 2 |
| Order management | ✅ Done | 1 |
| REST API (core endpoints) | ✅ Done | 1 |
| SRAtix Control plugin MVP | ✅ Scaffolded | 2 |
| SRAtix Client plugin MVP | ✅ Scaffolded | 2 |
| Multi-tenancy scaffolding | ✅ Done | 1 |
| Security baseline (auth, RBAC, validation) | ✅ Done | 1 |
| SSE real-time streams | ✅ Done | 2 |
| **Public ticket types endpoint** | ✅ Done | **3** |
| **Ticket issuance + QR codes** | ✅ Done | **3** |
| **Check-in system (online)** | ✅ Done | **3** |
| **Audit log (service + wiring)** | ✅ Done | **3** |
| **Email confirmations (scaffold)** | ✅ Done | **3** |
| Basic attendee management | ✅ Done (export pending) | 1 |
| Registration form engine | ⬜ Not started | — |
| Email confirmations (BullMQ worker) | ⬜ Not started | — |
| Basic invoice PDF generation | ⬜ Not started | — |
| Promo/discount codes | ⬜ Not started | — |
| Server dashboard MVP (Next.js) | ⬜ Not started | — |
| GDPR/nLPD compliance framework | ⬜ Not started | — |
| Rate limiting | ⬜ Not started | — |

---

## What's Next (Phase 2 Priority)

1. **Wire email confirmation** — call `EmailService.sendOrderConfirmation()` from webhook handler after ticket issuance
2. **Registration form engine** — JSON schema → rendered form → submission storage (FormSchema / FormSubmission tables ready)
3. **Promo/discount codes** — need schema addition (promo_codes table) + order creation logic
4. **Invoice PDF generation** — pdf-lib based, Swiss QR-bill format
5. **Badge template system** — satori rendering pipeline (Phase 2 architecture already defined)
6. **BullMQ worker** — move email + badge rendering to background jobs
7. **Auth TODO** — implement `wp_mappings` lookup and proper user creation on first token exchange
8. **Data export** — CSV/Excel export for attendees, orders, check-ins
9. **Rate limiting** — @nestjs/throttler or Fastify rate-limit plugin
10. **Server dashboard MVP** — Next.js with embedded SSE streams

## Technical Debt

- `auth.service.ts` — TODO: implement `wp_mappings` lookup and proper user creation
- `payments.controller.ts` — ticket type names in line items are currently IDs; resolve to names
- Client `sratix-embed.js` — ticket selection click handler needs registration form modal
- Email templates — Phase 1 is inline HTML; Phase 2 should use MJML for responsive design
- SSE — upgrade to Redis Pub/Sub for multi-process deployments
