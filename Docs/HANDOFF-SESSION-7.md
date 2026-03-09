# SRAtix — Session 7 Handoff

**Date**: 2026-03-09  
**Focus**: Multi-Ticket Recipient Registration Flow  
**Feature**: Purchasers can buy multiple tickets and assign each to a different recipient via name + email. Recipients receive tokenized registration links, complete registration, and get their tickets.  
**Test mode**: All recipient features work identically in Stripe Test Mode — no special handling needed.

---

## What Was Done

### Phase 1 — Schema & Data Model ✅

**`Server/prisma/schema.prisma`** — Extended `Attendee` model:
- `status` (`String @db.VarChar(30)`, default `'registered'`) — lifecycle: `invited` → `registered` → `confirmed`
- `registrationToken` (`String? @unique @db.VarChar(64)`) — 64-char hex for tokenized registration links
- `registrationTokenExpiresAt` (`DateTime?`) — set to event `endDate` at 23:59:59
- `purchasedByAttendeeId` (`String? @db.Char(36)`) — self-referencing FK to purchaser attendee
- Two relations: `purchasedBy` / `purchasedFor`
- Two indexes: `registrationToken` (unique), `purchasedByAttendeeId`

**`Server/prisma/migrations/add_attendee_recipient_fields.sql`** — NEW migration file with ALTER TABLE, indexes, FK constraint.

### Phase 2 — Checkout Flow Extension ✅

**`Server/src/payments/public-checkout.controller.ts`**:
- New DTOs: `AdditionalAttendeeDto` (email, firstName, lastName), extended `PublicCheckoutDto` (includeTicketForSelf, additionalAttendees, billingEmail, billingName)
- Added `TicketsService`, `EmailService`, `RegistrationReminderWorker` injection
- Event select now includes `endDate`, `startDate`, `venue`
- Step 3c: recipient attendee creation via `attendees.upsertRecipient()` with token generation (`randomBytes(32)`)
- Consolidated order meta: `{ isTestOrder, recipientAttendees, includeTicketForSelf, registrationBaseUrl }`
- Free ticket path: issues tickets, reassigns to recipients, sends gift notifications, schedules reminders

**`Server/src/payments/stripe-webhook.controller.ts`**:
- `issued` variable scoped outside try block for post-issuance access
- After ticket issuance: reads `orderMeta.recipientAttendees`, reassigns tickets to correct attendees
- Sends gift notification emails, schedules 7+30-day reminders via `RegistrationReminderWorker`

### Phase 3 — Email Templates ✅

**`Server/src/email/email.service.ts`** — 4 new public methods:
- `sendTicketGiftNotification()` — gift notification with registration link + spam note (uses `publicWrapper`)
- `sendRecipientRegistrationConfirmation()` — confirmation after registration (uses `publicWrapper`)
- `sendRecipientRegisteredNotification()` — notifies purchaser when recipient registers (uses `adminWrapper`)
- `sendRegistrationReminder()` — 7-day/30-day with urgency adjustment (uses `publicWrapper`)

New private helper: `publicWrapper()` — HTML wrapper like `adminWrapper()` but with public-facing footer ("SRAtix Ticketing Platform").

### Phase 4 — Public Registration Endpoint ✅

**`Server/src/attendees/public-registration.controller.ts`** — NEW controller:
- `GET /api/public/register/:token` — validates token, checks expiry, returns form schema + pre-filled attendee data
- `POST /api/public/register/:token` — validates token, saves form data, marks `status='registered'`, clears token, sends confirmation to recipient + notification to purchaser

**`Server/src/attendees/attendees.service.ts`** — 2 new methods:
- `upsertRecipient()` — find-or-create attendee with `status='invited'`, generates token, no webhook fire
- `findByRegistrationToken()` — token lookup with related event and purchaser data

**`Server/src/attendees/attendees.module.ts`** — Added `PublicRegistrationController`, imported `EmailModule`.

### Phase 5 — Reminder Emails ✅

**`Server/src/queue/registration-reminder.worker.ts`** — NEW worker:
- `scheduleReminders(attendeeId, eventId)` — creates two BullMQ delayed jobs (7-day, 30-day) on `reminder` queue
- Worker processor checks attendee status (`invited`) and token validity before sending
- Graceful degradation when Redis unavailable

**`Server/src/queue/queue.service.ts`** — Added `'reminder'` queue (now 7 queues total), `'reminder.registration'` job type with payload interface.

**`Server/src/queue/queue.module.ts`** — Registered and exported `RegistrationReminderWorker`.

### Phase 6 — Client Widget UI ✅

**`sratix-client/public/js/sratix-embed.js`**:
- Quantity modal: "Include a ticket for myself" checkbox (shown when qty > 1)
- New `openRecipientDetailsModal()` — renders N recipient forms (firstName, lastName, email), validates all fields, warns on duplicate emails (non-blocking)
- Updated `openRegistrationModal` signature to accept `includeTicketForSelf` and `additionalAttendees`
- Payload extended with recipient data

### Phase 7 — Registration Page (WP Shortcode) ✅

**`sratix-client/public/js/sratix-embed.js`** — New `initRegisterWidget()`:
- Detects `sratix-register-widget` div, reads `?token=` URL param
- Fetches registration info from API, renders form (custom schema or default)
- Submits registration, shows success/error states

**`sratix-client/includes/class-sratix-client-public.php`**:
- Added `[sratix_register]` shortcode registration
- Added to `has_shortcode` check for asset loading
- New `render_register()` method

### Phase 8 — Dashboard Visibility ✅

**`Dashboard/src/lib/api.ts`** — `Attendee` interface extended with `status?` and `purchasedByAttendeeId?`.

**`Dashboard/src/app/dashboard/events/[id]/attendees/client.tsx`** — Added status badge column with color-coded badges:
- `registered` = green (`#d4edda`)
- `invited` = yellow (`#fff3cd`)
- `confirmed` = blue (`#cce5ff`)

### Phase 9 — Documentation ✅

**`Docs/PRODUCTION-ARCHITECTURE.md`**:
- New subsection "Multi-Ticket Recipient Flow" in §9 Payments
- Updated §12 Email & SMS with new email types and public/admin wrapper documentation

**`Docs/MULTI-TICKET-RECIPIENTS-PLAN.md`** — Status updated to "✅ Implementation complete".

---

## Files Changed Summary

| File | Change |
|------|--------|
| `Server/prisma/schema.prisma` | Extended Attendee model (4 new fields, 2 relations, 2 indexes) |
| `Server/prisma/migrations/add_attendee_recipient_fields.sql` | **NEW** — migration SQL |
| `Server/src/payments/public-checkout.controller.ts` | Extended DTOs, recipient creation, ticket assignment |
| `Server/src/payments/stripe-webhook.controller.ts` | Recipient ticket reassignment, gift emails, reminders |
| `Server/src/email/email.service.ts` | 4 new email methods + publicWrapper helper |
| `Server/src/attendees/attendees.service.ts` | `upsertRecipient()`, `findByRegistrationToken()` |
| `Server/src/attendees/attendees.module.ts` | Registered controller, imported EmailModule |
| `Server/src/attendees/public-registration.controller.ts` | **NEW** — token-based registration API |
| `Server/src/queue/registration-reminder.worker.ts` | **NEW** — delayed reminder worker |
| `Server/src/queue/queue.service.ts` | Added `reminder` queue + job type |
| `Server/src/queue/queue.module.ts` | Registered reminder worker |
| `sratix-client/public/js/sratix-embed.js` | Recipient details UI, self-ticket toggle, registration widget |
| `sratix-client/includes/class-sratix-client-public.php` | `[sratix_register]` shortcode |
| `Dashboard/src/lib/api.ts` | Attendee type extensions |
| `Dashboard/src/app/dashboard/events/[id]/attendees/client.tsx` | Status badge column |
| `Docs/PRODUCTION-ARCHITECTURE.md` | Multi-ticket recipient documentation |
| `Docs/MULTI-TICKET-RECIPIENTS-PLAN.md` | Status → complete |
| `Docs/HANDOFF-SESSION-7.md` | **NEW** — this file |

---

## Before Going Live

### Migration
Run the SQL migration against the database:
```sql
-- File: Server/prisma/migrations/add_attendee_recipient_fields.sql
-- Then regenerate Prisma client:
npx prisma generate
```

### WordPress Setup
1. Create a page with `[sratix_register]` shortcode for the registration landing page
2. Set `REGISTRATION_BASE_URL` in server environment (e.g., `https://swiss-robotics.org/register`)

### Verification Checklist
- [ ] POST checkout with 3 qty (1 self + 2 recipients) → 3 attendees created, 2 with `status:invited` + tokens
- [ ] Stripe webhook → 3 tickets assigned to 3 different attendees + 2 gift emails sent
- [ ] GET/POST `/api/public/register/:token` → form returned with pre-fill, status → `registered`, token cleared
- [ ] Expired token → 410 Gone; used token → 404
- [ ] Non-attending purchaser (self unchecked) → billing info stored, no self-attendee
- [ ] Duplicate email warning shown when recipient matches existing attendee
- [ ] Order confirmation includes spam-check note when recipients exist
- [ ] Reminder job: 8-day-old invited attendee → reminder sent
- [ ] Full end-to-end in Stripe Test Mode with test card

### Known Stubs
- **Ticket PDF attachment**: Gift notification emails include a text note about the ticket but do not attach a PDF. Requires future PDF generation pipeline enhancement.
- **`confirmed` status**: Not auto-set. Reserved for future admin confirmation or check-in workflow.
