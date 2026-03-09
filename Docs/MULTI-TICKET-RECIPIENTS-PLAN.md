# Multi-Ticket Recipient Registration Flow

> **Date:** 2026-03-09
> **Status:** ✅ Implementation complete
> **Author:** TAROS Web Services / AI Architecture Session (Session 7)

---

## Overview

When a purchaser buys multiple tickets, they can designate recipients (name + email) for each extra ticket. Purchasers may optionally include a ticket for themselves or buy tickets only for others.

After payment is confirmed, each recipient receives an invitation email with event details and a tokenized registration link. Recipients complete the same registration form assigned to their ticket type (pre-filled with known data). Completing registration triggers confirmation emails to both the recipient and the original purchaser, and updates attendee status.

Automated reminders are sent at 7 and 30 days for unregistered recipients.

---

## Decisions Log

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Purchaser ticket allocation | Flexible — checkbox "Include a ticket for myself" (default checked). Billing details collected either way. |
| 2 | Registration token expiry | Until event end date, at 23:59:59 in event timezone — allows registration during the event. |
| 3 | Reminder emails | 7-day and 30-day automated reminders via BullMQ cron. |
| 4 | Duplicate email warning | Warn purchaser at checkout if a recipient email matches an existing attendee for the event. Allow override. |
| 5 | Spam folder note | Include a line in purchaser's order confirmation asking recipients to check spam if they don't receive the email. |
| 6 | Max recipients per order | Use existing `maxPerOrder` from TicketType — no separate cap. |
| 7 | Ticket PDF attachment | **Stubbed** — placeholder in email + documented gap. Requires future PDF generation pipeline. |
| 8 | `confirmed` status | Not auto-set on registration; stays `registered`. Reserved for future admin workflow. |

---

## Phase 1 — Schema & Data Model

### 1.1 Extend `Attendee` model (Prisma)

Add to `attendees` table:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `status` | `String @db.VarChar(30)` | `'registered'` | `invited \| registered \| confirmed \| cancelled` |
| `registrationToken` | `String? @unique @db.VarChar(64)` | `null` | 64-char hex token for tokenized registration link |
| `registrationTokenExpiresAt` | `DateTime?` | `null` | Event end date at 23:59:59 in event timezone |
| `purchasedByAttendeeId` | `String? @db.Char(36)` | `null` | Self-referencing FK to purchaser attendee |

**Attendee status lifecycle:**
```
invited      → recipient created at checkout with minimal data (name + email)
registered   → completed registration form (default for self-purchased, backward compat)
confirmed    → reserved for future admin confirmation workflow
cancelled    → attendee cancelled
```

**Relations:**
- `purchasedBy Attendee? @relation("PurchasedForBy", ...)`
- `purchasedFor Attendee[] @relation("PurchasedForBy")`

### 1.2 Migration

File: `prisma/migrations/add_attendee_recipient_fields.sql`

All fields nullable or defaulted — fully backward compatible.

---

## Phase 2 — Checkout Flow Extension

### 2.1 Extend `PublicCheckoutDto`

New fields:

```typescript
includeTicketForSelf?: boolean;     // default true
additionalAttendees?: AdditionalAttendeeDto[];  // [{firstName, lastName, email}]
billingEmail?: string;              // when purchaser is not attending
billingName?: string;               // when purchaser is not attending
```

**Validation:**
- `totalTickets = (includeTicketForSelf ? 1 : 0) + additionalAttendees.length` must equal `quantity`
- If `includeTicketForSelf` is false: `billingEmail` required
- Warn if any `additionalAttendees[].email` matches an existing attendee for the event

### 2.2 Checkout method extension

After existing attendee upsert (purchaser):

1. For each `additionalAttendees` entry:
   - Upsert attendee by `(eventId, email)`
   - Set `status = 'invited'`, generate `registrationToken` (64-char hex via `crypto.randomBytes(32)`)
   - Set `registrationTokenExpiresAt` = event endDate at 23:59:59
   - Set `purchasedByAttendeeId` = purchaser's attendee ID
2. Store recipient mapping in `order.meta.recipientAttendees`:
   ```json
   [{ "attendeeId": "...", "ticketTypeId": "...", "registrationToken": "..." }]
   ```
3. If `includeTicketForSelf` is false: set `order.attendeeId = null`, store billing info in `order.customerEmail`/`order.customerName`

### 2.3 Ticket issuance extension (post-payment)

In `handleCheckoutComplete()`:

After `tickets.issueForOrder()`:
1. Read `order.meta.recipientAttendees`
2. Assign tickets to correct attendees:
   - Self-ticket (if applicable) → purchaser attendee
   - Remaining → recipients by index
3. Send `emailService.sendTicketGiftNotification()` to each recipient
4. Include spam-check note in purchaser's order confirmation

---

## Phase 3 — Email Templates

### 3.1 `sendTicketGiftNotification()`

**To:** Recipient  
**Subject:** "[Purchaser Name] has purchased a Swiss Robotics Day 2026 ticket for you!"

Content:
- Greeting with recipient's first name
- "[Purchaser First Last] has purchased a ticket for you"
- Ticket summary: type name, price
- Event details: name, date(s), venue, location
- Big red CTA button: "Complete Your Attendee Profile" → `{clientBaseUrl}/register?token={registrationToken}`
- Explanatory text about badge printing and matchmaking

### 3.2 `sendRecipientRegistrationConfirmation()`

**To:** Recipient (after form completion)  
**Subject:** "Your registration for Swiss Robotics Day 2026 is confirmed"

Content:
- Summary of submitted form details
- Event details
- Ticket PDF attachment — **STUB/PLACEHOLDER**

### 3.3 `sendRecipientRegisteredNotification()`

**To:** Original purchaser (when recipient completes registration)  
**Subject:** "[Recipient Name] has completed their registration"

Content:
- "[Recipient First Last] completed their attendee registration"
- Progress: "X of Y recipients have completed registration"

### 3.4 `sendRegistrationReminder()`

**To:** Recipient (7-day and 30-day)  
**Subjects:**
- 7-day: "Reminder: Complete your attendee profile for Swiss Robotics Day 2026"
- 30-day: "Last reminder: Your Swiss Robotics Day 2026 registration is still incomplete"

Same CTA button as gift notification.

---

## Phase 4 — Public Registration Endpoint

### 4.1 `PublicRegistrationController`

New file: `Server/src/attendees/public-registration.controller.ts`  
Route prefix: `public/register`

**GET `/api/public/register/:token`**
- Validate token exists, not expired
- Return: `{ attendee: {firstName, lastName, email}, formSchema, event, ticketType }`
- Pre-fill: `{firstName, lastName, email}` from attendee record

**POST `/api/public/register/:token`**
- Rate limited: 10/min
- Validate token + not expired
- Accept: form answers + optional profile updates
- Update attendee profile, set `status = 'registered'`, clear token
- Create `FormSubmission` record
- Send confirmation emails to both recipient and purchaser
- Return: `{ success: true, attendee }`

### 4.2 Service helpers

Add to `AttendeesService`:
- `findByRegistrationToken(token)` — find attendee by token, check expiry
- `clearRegistrationToken(attendeeId)` — nullify token after use

---

## Phase 5 — Reminder Emails

### 5.1 BullMQ cron job: `registration-reminder`

Daily scan for attendees where:
- `status = 'invited'`
- `registrationToken IS NOT NULL`
- `registrationTokenExpiresAt > NOW()`

Logic:
- If `meta.remindersSent = 0` AND `createdAt + 7 days <= NOW()` → 7-day reminder
- If `meta.remindersSent = 1` AND `createdAt + 30 days <= NOW()` → 30-day reminder
- Track via `meta.remindersSent` counter

---

## Phase 6 — Client Widget (sratix-embed.js)

### 6.1 "Include ticket for myself" checkbox

In `openQuantityModal()`:
- Add checkbox below quantity stepper (default checked)
- When unchecked: show billing name + email fields
- Update price calculation to reflect total quantity

### 6.2 Recipient details step

After quantity confirmation, if `quantity > selfTickets`:
- New modal/section: "Recipient Details"
- For each additional ticket: card with First Name, Last Name, Email
- Client-side duplicate email warning (via API check)
- Validate all before proceeding

### 6.3 Checkout payload extension

Include `includeTicketForSelf`, `additionalAttendees`, `billingEmail`/`billingName` in POST body.

### 6.4 Post-purchase success note

Display: "Confirmation emails with registration instructions have been sent to [recipient names]. Please ask them to check their spam folder if they don't receive it."

---

## Phase 7 — Registration Page (WP Shortcode)

### 7.1 `[sratix_register]` shortcode

New shortcode in `sratix-client` plugin:
- Reads `?token=` from URL params
- Fetches form schema + pre-filled data from `GET /api/public/register/:token`
- Renders dynamic form using same field rendering system as checkout
- Submits to `POST /api/public/register/:token`
- Shows confirmation on success

---

## Phase 8 — Dashboard Admin Visibility

### 8.1 Attendee status column

In attendees DataTable: add `Status` column with badge (`invited` / `registered` / `confirmed` / `cancelled`).

### 8.2 Purchased-by display

In attendee detail: if `purchasedByAttendeeId` is set, show "Ticket purchased by: [Name] ([email])".

---

## Phase 9 — Documentation

### 9.1 PRODUCTION-ARCHITECTURE.md update

- Document recipient registration flow
- Token-based registration endpoint
- New email types
- Ticket PDF stub note

### 9.2 HANDOFF-SESSION-7.md

Session handoff with all changes made.

---

## Files Changed

| File | Change |
|------|--------|
| `Server/prisma/schema.prisma` | Extend Attendee model |
| `Server/prisma/migrations/add_attendee_recipient_fields.sql` | **NEW** — migration |
| `Server/src/payments/public-checkout.controller.ts` | Extend DTO + checkout logic |
| `Server/src/payments/stripe-webhook.controller.ts` | Assign tickets to recipients, send gift emails |
| `Server/src/email/email.service.ts` | 4 new email methods |
| `Server/src/attendees/attendees.service.ts` | Token lookup/clear helpers, status update |
| `Server/src/attendees/attendees.module.ts` | Register new controller |
| `Server/src/attendees/public-registration.controller.ts` | **NEW** — token-based registration |
| `Server/src/queue/registration-reminder.worker.ts` | **NEW** — reminder cron job |
| `Server/src/queue/queue.service.ts` | Register reminder queue + job types |
| `Server/src/queue/queue.module.ts` | Import reminder worker |
| `sratix-client/public/js/sratix-embed.js` | Recipient details UI, self-ticket toggle |
| `sratix-client/includes/class-sratix-client-public.php` | Register `[sratix_register]` shortcode |
| `Dashboard/src/app/dashboard/attendees/page.tsx` | Status column + purchased-by |
| `Docs/PRODUCTION-ARCHITECTURE.md` | Architecture update |
| `Docs/HANDOFF-SESSION-7.md` | **NEW** — session handoff |

---

## Verification Checklist

- [ ] POST checkout with 3 qty (1 self + 2 recipients) → 3 attendees created, 2 with `status:invited` + tokens
- [ ] Stripe webhook → 3 tickets assigned to 3 different attendees + 2 gift emails sent
- [ ] GET/POST `/api/public/register/:token` → form returned with pre-fill, status → `registered`, token cleared
- [ ] Expired token → 410 Gone; used token → 404
- [ ] Non-attending purchaser (self unchecked) → billing info stored, no self-attendee
- [ ] Duplicate email warning shown when recipient matches existing attendee
- [ ] Order confirmation includes spam-check note when recipients exist
- [ ] Reminder job: 8-day-old invited attendee → reminder sent, `meta.remindersSent` incremented
- [ ] Full end-to-end in test mode
