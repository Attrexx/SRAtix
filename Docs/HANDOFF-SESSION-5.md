# SRAtix — Session 5 Handoff

**Date**: 2026-01-06  
**Focus**: Dashboard MVP, Pre-Phase-2 Improvements, Phase 2 Scaffolding  
**Server grew from 62 → 72 TypeScript files, 16 → 20 Prisma models, 20 → 22 NestJS modules**  
**Dashboard created: 22 TypeScript/TSX files, 11 pages**

---

## What Was Done

### Pre-Phase-2 Improvements (3 items)

#### 1. Promo Codes Wired Into Checkout ✅
- Added `promoCode?: string` to `CreateCheckoutDto` in `payments.controller.ts`
- Injected `PromoCodesService` — validates code via `validateCode()` before creating Stripe session
- `StripeService.createCheckoutSession()` now accepts `discountAmountCents` — creates a one-time Stripe coupon (`amount_off`, `duration: 'once'`, `max_redemptions: 1`) and attaches via `discounts` array
- Stores `{ promoCodeId, discountCents }` in order meta via new `OrdersService.updateMeta()` method
- Passes `sratix_promo_code_id` in Stripe session metadata for webhook pickup
- Added `PromoCodesModule` import to `PaymentsModule`

#### 2. Promo Usage Increment in Webhook ✅
- Imported & injected `PromoCodesService` into `StripeWebhookController`
- After payment confirmation in `handleCheckoutComplete()`, reads `session.metadata?.sratix_promo_code_id` and calls `incrementUsage()`
- Fire-and-forget with error logging (promo tracking failure shouldn't break payment flow)

#### 3. Email Templates for Ticket Voided & Refund ✅
- Added `sendTicketVoided()` — styled HTML template with yellow warning box (ticket code, type, reason)
- Added `sendRefundNotification()` — green success box (order number, event, refund amount, 5–10 business days note)
- Both have plain text fallbacks
- Wired refund email into `handleChargeRefunded()` webhook handler

---

### Dashboard MVP ✅ (Complete — Next.js App Router)

Standalone Next.js 15 app with App Router, Tailwind CSS v4, TypeScript. Runs on port 3100 in development, proxied via rewrites to NestJS API.

#### 4. Dashboard Scaffold ✅
- `package.json` — next, react 19, clsx, date-fns, tailwindcss v4
- `tsconfig.json` — ES2022, bundler resolution, `@/*` path alias
- `next.config.ts` — API rewrites to `NEXT_PUBLIC_API_URL`
- `postcss.config.mjs` — `@tailwindcss/postcss` plugin
- `globals.css` — CSS custom properties for light/dark themes, scrollbar styling, animations

#### 5. Auth & Layout ✅
- **Login page** — WP token exchange form with error handling
- **AuthProvider** — React context with `login()`, `logout()`, `hasRole()`, JWT localStorage persistence
- **DashboardLayout** — Auth guard wrapper with sidebar, event ID extraction from pathname
- **Sidebar** — Platform nav (Events, Settings) + event-scoped nav (Overview, Attendees, Orders, Check-In, Analytics, Promo Codes, Forms, Export)
- **ThemeProvider** — system/light/dark mode with CSS class toggle
- **ThemeToggle** — Toggle buttons in sidebar footer

#### 6. Events Page ✅
- **Events list** (`/dashboard`) — card grid with event name, dates, venue, status badge, capacity
- **Event overview** (`/dashboard/events/[id]`) — stats grid (orders, revenue, attendees, check-ins), ticket types with sold/capacity progress bars
- Loading skeletons for both views

#### 7. Attendees Page ✅
- `DataTable` with search, column sorting, pagination
- Columns: name, email, company, ticket type, check-in status, registered date
- CSV export button

#### 8. Orders Page with SSE ✅
- `DataTable` with search + sort + pagination
- Columns: order number, customer, email, total, status (badge), tickets, date
- **SSE live updates** via `useSSEBuffer` hook — new orders appear in real-time with pulse animation
- CSV export button

#### 9. Check-In Live Page ✅
- **SSE real-time feed** — live check-in entries as they happen
- Capacity progress bar (checked-in / total attendees)
- Stats cards: total check-ins, checked-in %, avg check-in time, peak rate
- Each entry shows attendee name, ticket type, time, status badge

#### 10. Analytics Overview ✅
- KPI cards: total revenue, orders, avg order value, conversion rate
- Revenue breakdown by ticket type (horizontal bar chart)
- Order status distribution (PAID / PENDING / CANCELLED percentages)
- Daily revenue trend line (table-based)

#### Bonus Pages ✅
- **Promo Codes** — DataTable with code, discount, usage, validity dates, status
- **Forms** — Schema card grid showing field count and version
- **Export** — Download cards for Attendees, Orders, Check-ins, Form Submissions CSVs

#### Reusable Components
| Component | Purpose |
|-----------|---------|
| `DataTable` | Generic table with search, multi-column sort, pagination |
| `StatCard` | Metric card with icon, value, label, optional trend |
| `StatusBadge` | Color-coded status pills (active, paid, cancelled, etc.) |
| `Sidebar` | Collapsible nav with platform + event-scoped sections |
| `ThemeProvider` | System/light/dark theme with CSS class toggle |

#### Library Modules
| Module | Purpose |
|--------|---------|
| `api.ts` | Typed fetch client with JWT auth, 15+ endpoint methods |
| `auth.ts` | AuthProvider context (login, logout, token management) |
| `sse.ts` | `useSSE` + `useSSEBuffer` hooks for EventSource connections |

---

### Phase 2 Scaffolding (3 systems)

#### 11. Badge Template System ✅ (3 files + 2 Prisma models)
- **`BadgeTemplate` model** — eventId, name, description, layout (JSON), dimensions (JSON), ticketTypeIds (JSON), isDefault, active, version
- **`BadgeRender` model** — templateId, ticketId, attendeeId, format, fileUrl, fileSize, renderTimeMs, status, error
- **`badge-templates.service.ts`** (~290 LOC) — CRUD + satori rendering pipeline:
  - Token substitution: `{{attendeeName}}`, `{{company}}`, `{{ticketType}}`, `{{eventName}}`, `{{qrPayload}}`
  - Pipeline: JSON layout → satori SVG → @resvg/resvg-js PNG → pdf-lib PDF
  - Dynamic ESM imports for satori/@resvg/resvg-js/pdf-lib
  - Records each render in `BadgeRender` table with timing
  - Default layout: ISO ID-1 card (85.6×53.98mm at 300 DPI), dark gradient background
- **`badge-templates.controller.ts`** — GET list, GET one, GET default-layout, POST create, PATCH update, PATCH deactivate, POST render (returns file with Content-Disposition)

#### 12. BullMQ Queue System ✅ (4 files + module)
- **`queue.service.ts`** (~195 LOC) — Wraps BullMQ with ioredis connection
  - 6 named queues: `email`, `pdf`, `badge`, `export`, `sync`, `webhook`
  - Typed `addJob<T>()` with payload interfaces for all job types
  - `registerWorker()` — feature modules register their own processors
  - `getQueueStats()` — waiting/active/completed/failed/delayed counts
  - `isAvailable()` — graceful degradation when Redis not configured
  - Automatic cleanup: keeps last 100 completed / 500 failed jobs
  - 3 retry attempts with exponential backoff (2s base)
- **`email-queue.worker.ts`** — Processes `email.send` jobs via EmailService
- **`webhook-queue.worker.ts`** — Delivers outgoing webhooks with HMAC signature, 10s timeout
- **`queue.module.ts`** — `@Global()` module so QueueService is available everywhere
- Requires `REDIS_URL` env var (e.g. Upstash Redis). Falls back to inline processing if not set.
- BullMQ ^5.69.0 + ioredis ^5.9.0 already in package.json since Session 3.

#### 13. Outgoing Webhooks System ✅ (3 files + 2 Prisma models)
- **`WebhookEndpoint` model** — orgId, eventId (nullable for org-wide), url, secret (HMAC signing), events (JSON array), active
- **`WebhookDelivery` model** — endpointId, eventType, payload, status, httpStatus, responseBody, attempts, error, deliveredAt
- **`outgoing-webhooks.service.ts`** (~265 LOC):
  - Endpoint CRUD: create (auto-generates `whsec_` signing secret), update, delete, rotateSecret
  - `dispatch()` — finds matching active endpoints, filters by event type subscription, creates delivery records, enqueues via BullMQ (or falls back to inline HTTP POST)
  - `retryDelivery()` — re-enqueues a failed delivery
  - `getDeliveries()` — delivery log with pagination
  - Supported event types: `order.paid`, `order.refunded`, `ticket.issued`, `ticket.voided`, `checkin.created`, `attendee.registered`, `event.updated`
- **`outgoing-webhooks.controller.ts`** — Full REST API for endpoint management + delivery log + retry
- **Wired into Stripe webhook** — Replaced `// TODO: Fire webhook` with actual `dispatch('order.paid', ...)` call in `handleCheckoutComplete()`
- Added `OutgoingWebhooksModule` import to `PaymentsModule`

---

## Architecture After Session 5

### Module Inventory (22 NestJS modules)

| Module | Files | Purpose |
|--------|-------|---------|
| `AppModule` | 1 | Root orchestrator |
| `ConfigModule` | (NestJS built-in) | Environment variables |
| `PrismaModule` | 2 | Database ORM |
| `AuditLogModule` | 2 | @Global — fire-and-forget audit logging |
| `AuthModule` | 6 | JWT auth, WP token exchange, RBAC |
| `HealthModule` | 2 | Health check endpoint |
| `EventsModule` | 4 | Event CRUD |
| `TicketTypesModule` | 4 | Ticket type definitions + public endpoint |
| `OrdersModule` | 3 | Order management + Stripe session tracking |
| `AttendeesModule` | 3 | Attendee CRUD |
| `TicketsModule` | 3 | Ticket issuance, QR codes, void |
| `CheckInsModule` | 3 | QR validation, offline sync, stats |
| `PaymentsModule` | 4 | Stripe Checkout, webhook, refunds |
| `EmailModule` | 4 | SMTP transport abstraction, templates |
| `SseModule` | 3 | Real-time Server-Sent Events |
| `FormsModule` | 3 | Registration form engine (schemas + submissions) |
| `PromoCodesModule` | 3 | Discount/promo codes with validation |
| `InvoicesModule` | 3 | PDF invoice generation (pdf-lib) |
| `GdprModule` | 3 | GDPR/nLPD compliance (erasure, access, consent) |
| `ExportModule` | 3 | CSV data exports |
| **`QueueModule`** | 4 | **@Global — BullMQ job queues (Phase 2)** |
| **`BadgeTemplatesModule`** | 3 | **Badge template CRUD + satori render (Phase 2)** |
| **`OutgoingWebhooksModule`** | 3 | **Webhook endpoints + dispatch (Phase 2)** |

### Prisma Models (20)

Organization, Event, TicketType, Order, OrderItem, Attendee, Ticket, PromoCode, FormSchema, FormSubmission, CheckIn, User, UserRole, AuditLog, WpMapping, Setting, **BadgeTemplate** (new), **BadgeRender** (new), **WebhookEndpoint** (new), **WebhookDelivery** (new)

### Key New Endpoints

```
# Badge Templates (Phase 2)
GET    /api/badge-templates/event/:eventId              # List templates
GET    /api/badge-templates/:id                         # Get template
GET    /api/badge-templates/default-layout              # Get default layout JSON
POST   /api/badge-templates                             # Create template
PATCH  /api/badge-templates/:id                         # Update template
PATCH  /api/badge-templates/:id/deactivate              # Deactivate
POST   /api/badge-templates/:id/render                  # Render badge (returns file)

# Outgoing Webhooks (Phase 2)
GET    /api/webhooks/event-types                        # Available event types
GET    /api/webhooks/endpoints/:orgId                   # List org endpoints
GET    /api/webhooks/endpoints/:orgId/:eventId          # List event endpoints
GET    /api/webhooks/endpoint/:id                       # Get endpoint + deliveries
POST   /api/webhooks/endpoints                          # Create endpoint
PATCH  /api/webhooks/endpoint/:id                       # Update endpoint
DELETE /api/webhooks/endpoint/:id                       # Delete endpoint
POST   /api/webhooks/endpoint/:id/rotate-secret         # Rotate signing secret
GET    /api/webhooks/deliveries/:endpointId             # Delivery history
POST   /api/webhooks/deliveries/:id/retry               # Retry failed delivery
```

### Dashboard Pages (11)

| Route | Purpose |
|-------|---------|
| `/login` | WP token exchange login |
| `/dashboard` | Events list (card grid) |
| `/dashboard/events/[id]` | Event overview (stats, ticket types) |
| `/dashboard/events/[id]/attendees` | Attendee DataTable + CSV export |
| `/dashboard/events/[id]/orders` | Orders DataTable + SSE live updates |
| `/dashboard/events/[id]/check-in` | Live check-in feed (SSE) |
| `/dashboard/events/[id]/analytics` | Revenue, order stats, KPIs |
| `/dashboard/events/[id]/promo-codes` | Promo codes DataTable |
| `/dashboard/events/[id]/forms` | Form schemas card grid |
| `/dashboard/events/[id]/export` | Download CSV exports |

---

## Phase 1 Checklist — COMPLETE ✅

| Item | Status |
|------|--------|
| Event creation & configuration (CRUD) | ✅ Session 1 |
| Ticket type definitions | ✅ Session 1 |
| Registration form engine | ✅ Session 4 |
| Stripe Checkout integration | ✅ Session 2 |
| Order management | ✅ Session 1 |
| Ticket issuance with QR | ✅ Session 3 |
| Email confirmations | ✅ Session 3 + 4 |
| Basic attendee management | ✅ Session 1 |
| Basic invoice PDF generation | ✅ Session 4 |
| Promo/discount codes (basic) | ✅ Session 4 + **Session 5** (wired into checkout) |
| REST API (core endpoints) | ✅ Sessions 1–4 |
| SRAtix Control plugin MVP | ✅ Session 2 |
| SRAtix Client plugin MVP | ✅ Session 2 |
| GDPR/nLPD compliance framework | ✅ Session 4 |
| Audit log (basic) | ✅ Session 3 |
| Security baseline (auth, RBAC, rate limiting) | ✅ Sessions 1 + 4 |
| Multi-tenancy scaffolding | ✅ Session 1 |
| **Server dashboard MVP (Next.js)** | ✅ **Session 5** |
| Data export (attendees, orders, check-ins) | ✅ Session 4 |

**Phase 1 completion: 19/19 items ✅**

---

## Phase 2 Checklist — In Progress

| Item | Status |
|------|--------|
| Badge template system (satori pipeline) | ✅ Session 5 |
| BullMQ job queue infrastructure | ✅ Session 5 |
| Outgoing webhook system | ✅ Session 5 |
| Check-in scanner page (camera QR) | ⬜ |
| Multi-scanner management | ⬜ |
| Waitlist with auto-promotion | ⬜ |
| Bulk operations (email, badges, void) | ⬜ |
| Dashboard: webhook management page | ⬜ |
| Dashboard: badge template editor | ⬜ |
| Dashboard: queue monitoring page | ⬜ |
| Email queue integration (send via BullMQ) | ⬜ |
| Badge batch rendering via queue | ⬜ |
| WP plugin sync webhooks (ticket.issued → Client) | ⬜ |

---

## Files Created This Session

### Server (10 new files)

| File | ~LOC | Purpose |
|------|------|---------|
| `src/badge-templates/badge-templates.service.ts` | 290 | CRUD + satori rendering pipeline |
| `src/badge-templates/badge-templates.controller.ts` | 135 | Badge template REST API |
| `src/badge-templates/badge-templates.module.ts` | 12 | Module registration |
| `src/queue/queue.service.ts` | 195 | BullMQ wrapper — 6 queues, workers, stats |
| `src/queue/queue.module.ts` | 30 | @Global module |
| `src/queue/email-queue.worker.ts` | 65 | Email delivery worker |
| `src/queue/webhook-queue.worker.ts` | 85 | Webhook delivery worker with HMAC |
| `src/outgoing-webhooks/outgoing-webhooks.service.ts` | 265 | Endpoint CRUD + event dispatching |
| `src/outgoing-webhooks/outgoing-webhooks.controller.ts` | 100 | Webhook endpoint management API |
| `src/outgoing-webhooks/outgoing-webhooks.module.ts` | 15 | Module registration |

### Dashboard (22+ new files)

| File | Purpose |
|------|---------|
| `tsconfig.json` | TypeScript config |
| `next.config.ts` | API rewrites |
| `postcss.config.mjs` | Tailwind CSS v4 |
| `package.json` | Dependencies (next, react 19, tailwindcss v4) |
| `.env.example` | Environment vars |
| `src/app/globals.css` | Theme variables, animations |
| `src/app/layout.tsx` | Root layout + ThemeProvider |
| `src/app/page.tsx` | Root redirect |
| `src/app/login/page.tsx` | WP token exchange login |
| `src/app/dashboard/layout.tsx` | Auth guard + sidebar shell |
| `src/app/dashboard/page.tsx` | Events list |
| `src/app/dashboard/events/[id]/page.tsx` | Event overview |
| `src/app/dashboard/events/[id]/attendees/page.tsx` | Attendees table |
| `src/app/dashboard/events/[id]/orders/page.tsx` | Orders table + SSE |
| `src/app/dashboard/events/[id]/check-in/page.tsx` | Live check-in feed |
| `src/app/dashboard/events/[id]/analytics/page.tsx` | Analytics charts |
| `src/app/dashboard/events/[id]/promo-codes/page.tsx` | Promo codes table |
| `src/app/dashboard/events/[id]/forms/page.tsx` | Form schemas |
| `src/app/dashboard/events/[id]/export/page.tsx` | Export downloads |
| `src/lib/api.ts` | API client (15+ endpoints) |
| `src/lib/auth.ts` | Auth context provider |
| `src/lib/sse.ts` | SSE hooks |
| `src/components/sidebar.tsx` | Navigation sidebar |
| `src/components/data-table.tsx` | Generic data table |
| `src/components/stat-card.tsx` | Stat card component |
| `src/components/status-badge.tsx` | Status badge component |
| `src/components/theme-provider.tsx` | Theme context |
| `src/components/theme-toggle.tsx` | Theme toggle buttons |

### Server Files Modified (7)

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | +4 models (BadgeTemplate, BadgeRender, WebhookEndpoint, WebhookDelivery), +relations to Event/Attendee/Ticket/Organization |
| `src/app.module.ts` | +3 module imports (QueueModule, BadgeTemplatesModule, OutgoingWebhooksModule) |
| `src/payments/payments.controller.ts` | Promo code validation + discount in checkout flow |
| `src/payments/stripe.service.ts` | On-the-fly Stripe coupon creation for promo discounts |
| `src/payments/stripe-webhook.controller.ts` | +PromoCodesService (usage increment), +OutgoingWebhooksService (order.paid dispatch), +refund email |
| `src/payments/payments.module.ts` | +PromoCodesModule, +OutgoingWebhooksModule imports |
| `src/orders/orders.service.ts` | +`updateMeta()` method for JSON meta merge |
| `src/email/email.service.ts` | +`sendTicketVoided()`, +`sendRefundNotification()` templates |

---

## Deployment Notes

Before deploying Session 5 changes:

1. **Push schema changes**: `npx prisma db push` (adds 4 new tables: `badge_templates`, `badge_renders`, `webhook_endpoints`, `webhook_deliveries`)
2. **Optional: Set REDIS_URL** for BullMQ (e.g. Upstash Redis). Without it, all jobs process inline (Phase 1 behavior persists).
3. **Optional: Set WEBHOOK_SIGNING_SECRET** for outgoing webhook HMAC signatures (defaults to `sratix-webhook-default`)
4. **Dashboard deployment**: `cd Dashboard && npm install && npm run build` — deploy `.next/` output
5. **No new npm dependencies for Server** (BullMQ + ioredis already in package.json since Session 3)

---

## Project Totals

| Metric | Count |
|--------|-------|
| Server TypeScript files | 72 |
| NestJS modules | 22 |
| Prisma models | 20 |
| REST API endpoints | ~65 |
| Dashboard TypeScript/TSX files | 22 |
| Dashboard pages | 11 |
| WP plugins | 2 (Control + Client) |
| Sessions completed | 5 |
| Phase 1 items | 19/19 ✅ |
| Phase 2 items scaffolded | 3 |
