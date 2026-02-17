# SRAtix — Session 4 Handoff

**Date**: 2026-01-05  
**Focus**: Completing remaining Phase 1 items  
**Server grew from 46 → 62 TypeScript files, 15 → 16 Prisma models, 14 → 20 NestJS modules**

---

## What Was Done

### 1. Email Wired Into Webhook ✅
- Imported `EmailService` into `stripe-webhook.controller.ts`
- After ticket issuance on `checkout.session.completed`, calls `sendOrderConfirmation()` with event details
- Added `findEventForOrder()` and `findOneWithDetails()` to `OrdersService`
- Added `EmailModule` import to `PaymentsModule`

### 2. Registration Form Engine ✅ (3 files)
- **`forms.service.ts`** — Schema CRUD (create w/ auto-versioning, find by event, find active, deactivate) + submission (validate answers against schema fields, create submission, find by event/attendee)
- **`forms.controller.ts`** — Admin: GET/POST/PATCH schema endpoints; Public: GET schema for ticket type + POST submission (unauthenticated for Client widget)
- **`forms.module.ts`** — Registers `FormsController` + `FormsPublicController`
- Field validation: required fields, email format, number coercion, multi-select array check, consent objects, string length limits
- Versioned schemas: creating a schema with the same name auto-increments version and deactivates previous versions

### 3. Promo/Discount Codes ✅ (3 files + 1 Prisma model)
- **New model**: `PromoCode` in `schema.prisma` — code, eventId, discountType (percentage/fixed_amount), discountValue, usageLimit, usedCount, perCustomerLimit, validFrom/validTo, applicableTicketIds (JSON), minOrderCents
- **`promo-codes.service.ts`** — CRUD + `validateCode()` (checks active, usage limit, date validity, min order, applicable tickets, per-customer limit) + `incrementUsage()`
- **`promo-codes.controller.ts`** — Admin CRUD + `POST validate/event/:eventId` for checkout flow
- Codes normalized to uppercase, duplicate detection per event

### 4. Invoice PDF Generation ✅ (3 files)
- **`invoices.service.ts`** — Generates A4 PDF using `pdf-lib` (pure JS, no native deps)
  - Sequential invoice numbering (INV-2026-0001) using global counter in Settings table
  - Full A4 layout: header with invoice number/date, issuer/bill-to blocks, order reference, line items table with per-row pricing, subtotal/total, payment status, footer
  - `formatCurrency()` helper for CHF display
- **`invoices.controller.ts`** — `GET /api/invoices/order/:orderId` (download) + `GET .../preview` (inline browser display)
- **`invoices.module.ts`** — Standard module
- Added `pdf-lib: ^1.17.1` to package.json

### 5. Rate Limiting ✅ (1 file + wiring)
- **`common/guards/rate-limit.guard.ts`** — Custom NestJS guard with in-memory store
  - Default: 100 req/60s per IP
  - Per-route override via `@RateLimit({ limit, windowSec })` decorator
  - `@SkipRateLimit()` decorator for health/webhooks
  - Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers
  - Automatic cleanup of expired entries every 5 minutes
  - 429 Too Many Requests with `retryAfterSec` in response
- Registered as global guard in `main.ts`
- Tighter limits on: auth endpoint (20/min), public form submission (30/min), GDPR endpoints (5-10/min)
- Skipped on: health endpoint, Stripe webhook

### 6. GDPR/nLPD Compliance ✅ (3 files)
- **`gdpr.service.ts`**:
  - `getAttendeeData()` — Data Subject Access Request (Art. 15 GDPR): returns all PII, orders, tickets, form submissions, check-ins
  - `eraseAttendee()` — Right to erasure (Art. 17): transactional anonymization of attendee PII, form submission data, order customer info; voids active tickets; preserves financial records for Swiss 10-year retention; supports `dryRun` mode
  - `getConsentRecords()` — Extracts consent-type field answers from form submissions with timestamps
  - `findExpiredAttendees()` — Identifies attendees eligible for data purge based on configurable retention period
- **`gdpr.controller.ts`** — `GET access/:id`, `DELETE erasure/:id`, `GET consent/:id`, `GET retention/event/:eventId`
- All operations audit-logged via AuditLogService

### 7. Data Export (CSV) ✅ (3 files)
- **`export.service.ts`** — Generates RFC 4180 CSV with UTF-8 BOM for Excel compatibility
  - `exportAttendees()` — Name, email, phone, company, ticket codes/statuses
  - `exportOrders()` — Order number, status, customer info, line items, Stripe ref, timestamps
  - `exportCheckIns()` — Ticket code, type, attendee, method, direction, device, location, timestamp
  - `exportFormSubmissions()` — Dynamic headers from schema fields, attendee info, all answers
- **`export.controller.ts`** — `GET /api/export/{attendees|orders|check-ins|submissions}/event/:eventId`
- Rate-limited: 20 req/min (exports can be expensive)

### 8. Auth WpMappings Fix ✅
- Replaced placeholder `wp_${site}_${id}` with proper `WpMapping` table lookup
- On first login: creates `User` record + `WpMapping` entry
- On subsequent logins: looks up mapping, refreshes last login time
- Now accepts optional `email` and `displayName` from WP plugin to populate user record
- Updates email/displayName on each login if WP provides fresh values
- JWT payload now includes real `orgId` from WpMapping

---

## Architecture After Session 4

### Module Inventory (20 NestJS modules)

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

### Prisma Models (16)
Organization, Event, TicketType, Order, OrderItem, Attendee, Ticket, **PromoCode** (new), FormSchema, FormSubmission, CheckIn, User, UserRole, AuditLog, WpMapping, Setting

### Key New Endpoints

```
# Registration Forms
GET    /api/forms/event/:eventId                        # List schemas
POST   /api/forms                                       # Create schema
PATCH  /api/forms/:id/event/:eventId/deactivate         # Deactivate
GET    /api/forms/event/:eventId/submissions             # List submissions
POST   /api/forms/submit                                # Submit (admin)
GET    /api/public/forms/ticket-type/:ttId/event/:eId   # Public: get form for ticket type
POST   /api/public/forms/submit                          # Public: submit form

# Promo Codes
GET    /api/promo-codes/event/:eventId                  # List
POST   /api/promo-codes                                 # Create
PATCH  /api/promo-codes/:id/event/:eventId              # Update
PATCH  /api/promo-codes/:id/event/:eventId/deactivate   # Deactivate
POST   /api/promo-codes/validate/event/:eventId          # Validate & calculate discount

# Invoices
GET    /api/invoices/order/:orderId                     # Download PDF
GET    /api/invoices/order/:orderId/preview             # Preview in browser

# GDPR
GET    /api/gdpr/access/:attendeeId                    # Data access request
DELETE /api/gdpr/erasure/:attendeeId                   # Right to erasure
GET    /api/gdpr/consent/:attendeeId                   # Consent records
GET    /api/gdpr/retention/event/:eventId              # Find expired attendees

# Data Export
GET    /api/export/attendees/event/:eventId            # Attendees CSV
GET    /api/export/orders/event/:eventId               # Orders CSV
GET    /api/export/check-ins/event/:eventId            # Check-ins CSV
GET    /api/export/submissions/event/:eventId          # Form submissions CSV
```

---

## Phase 1 Checklist Status

| Item | Status |
|------|--------|
| Event creation & configuration (CRUD) | ✅ Session 1 |
| Ticket type definitions | ✅ Session 1 |
| Registration form engine | ✅ **Session 4** |
| Stripe Checkout integration | ✅ Session 2 |
| Order management | ✅ Session 1 |
| Ticket issuance with QR | ✅ Session 3 |
| Email confirmations | ✅ Session 3 + **Session 4** (wired into webhook) |
| Basic attendee management | ✅ Session 1 |
| Basic invoice PDF generation | ✅ **Session 4** |
| Promo/discount codes (basic) | ✅ **Session 4** |
| REST API (core endpoints) | ✅ Sessions 1-4 |
| SRAtix Control plugin MVP | ✅ Session 2 |
| SRAtix Client plugin MVP | ✅ Session 2 |
| GDPR/nLPD compliance framework | ✅ **Session 4** |
| Audit log (basic) | ✅ Session 3 |
| Security baseline (auth, RBAC, rate limiting) | ✅ Sessions 1 + **Session 4** (rate limiting) |
| Multi-tenancy scaffolding | ✅ Session 1 |
| Server dashboard MVP (Next.js) | ⬜ **Deferred to Session 5** |
| Data export (attendees, orders, check-ins) | ✅ **Session 4** |

**Phase 1 completion: 18/19 items ✅** — Only the Next.js dashboard remains.

---

## What's Next (Session 5)

### Server Dashboard MVP (Next.js)
The only remaining Phase 1 item. This is a standalone Next.js app for event admins:
- Event configuration page
- Attendee list with search/filter
- Orders list with payment status
- Check-in live dashboard
- Form schema management UI
- Basic analytics (sales, attendance counts)

### Pre-Phase-2 Improvements
- Wire promo code validation into checkout flow (`PaymentsController.createCheckout`)
- Wire `promoCodesService.incrementUsage()` into webhook after payment confirmation
- Add email templates for common notifications (ticket voided, refund issued)
- Run `npx prisma db push` to sync PromoCode model to database

### Phase 2 Readiness
- Badge template system (satori rendering pipeline)
- Check-in system enhancements (scanner page)
- BullMQ job queue integration
- KPI dashboard
- Webhook system (outgoing to WP plugins)

---

## Files Created This Session

| File | Size | Purpose |
|------|------|---------|
| `src/forms/forms.service.ts` | ~250 LOC | Form schema CRUD + submission validation |
| `src/forms/forms.controller.ts` | ~175 LOC | Admin + public form endpoints |
| `src/forms/forms.module.ts` | ~12 LOC | Module registration |
| `src/promo-codes/promo-codes.service.ts` | ~245 LOC | Promo code CRUD + validation engine |
| `src/promo-codes/promo-codes.controller.ts` | ~175 LOC | Admin CRUD + validate endpoint |
| `src/promo-codes/promo-codes.module.ts` | ~12 LOC | Module registration |
| `src/invoices/invoices.service.ts` | ~280 LOC | A4 PDF generation with pdf-lib |
| `src/invoices/invoices.controller.ts` | ~60 LOC | Download + preview endpoints |
| `src/invoices/invoices.module.ts` | ~12 LOC | Module registration |
| `src/gdpr/gdpr.service.ts` | ~255 LOC | Erasure, access, consent, retention |
| `src/gdpr/gdpr.controller.ts` | ~85 LOC | GDPR endpoints |
| `src/gdpr/gdpr.module.ts` | ~12 LOC | Module registration |
| `src/export/export.service.ts` | ~215 LOC | CSV generation for all entity types |
| `src/export/export.controller.ts` | ~90 LOC | CSV download endpoints |
| `src/export/export.module.ts` | ~12 LOC | Module registration |
| `src/common/guards/rate-limit.guard.ts` | ~135 LOC | Global rate limiter guard |

**Total new files**: 16  
**Total modified files**: 8 (app.module.ts, main.ts, auth.service.ts, auth.controller.ts, orders.service.ts, stripe-webhook.controller.ts, payments.module.ts, health.controller.ts)

---

## Deployment Notes

Before deploying Session 4 changes:

1. **Install new dependency**: `npm install pdf-lib@^1.17.1`
2. **Push schema changes**: `npx prisma db push` (adds `promo_codes` table)
3. **No new env vars required** (SRA_VAT_NUMBER is optional for invoice header)
4. Other changes are purely code — deploy and restart
