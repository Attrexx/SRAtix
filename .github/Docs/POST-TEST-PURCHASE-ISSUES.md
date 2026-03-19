# SRAtix Post-Test-Purchase Issues & Fix Plan

**Date:** 2026-03-19  
**Context:** First successful test exhibitor ticket purchase (order #TIX-2026-0017, 1300 CHF Industry/Government exhibitor). Stripe webhook worked, emails sent, exhibitor provisioned. 12 issues identified across server, dashboard, emails, and WordPress portal.

---

## Issue Map

| # | Title | Severity | Phase | Status |
|---|-------|----------|-------|--------|
| 1 | Exhibitor portal "Unable to load" | CRITICAL | 1 | TODO |
| 2 | Admin notification email needs richer data | MEDIUM | 3 | DONE |
| 3 | Ticket codes/QR in emails | LOW | 3 | DONE |
| 4 | Registration URL uses hardcoded `/register` instead of event page paths | HIGH | 2 | DONE |
| 5 | Emails use Stripe card name instead of registration name | HIGH | 2 | DONE |
| 6a | "D-239" countdown format unclear | LOW | 3 | DONE |
| 6b | Ticket sold counters always zero | HIGH | 2 | DONE |
| 6c | Dollar sign icon for CHF revenue | LOW | 3 | DONE |
| 7 | Tickets page shows 0 sold (same root as 6b) | HIGH | 2 | DONE |
| 8 | Purchaser missing from attendees list | MEDIUM | 2 | VERIFY |
| 9a | Exhibitor name shows Stripe card name | HIGH | 2 | DONE |
| 9b | Staff count shows 0/3 instead of 1/3 | MEDIUM | 2 | DONE |
| 10 | Order confirmation email shows UUID instead of ticket type name | HIGH | 2 | DONE |
| 11 | Password setup link goes to SRAtix Dashboard | CRITICAL | 1 | TODO |
| 12 | Portal login fails / redirects wrong | CRITICAL | 1 | TODO |

---

## Phase 1 — Critical: Exhibitor Portal Auth Flow

Issues 1, 11, 12 are interconnected. The exhibitor provisioning flow creates a SRAtix User but:

### Issue 11: Password setup link goes to SRAtix Dashboard

**Root cause:** Hard-coded URL in two places:
- `stripe-webhook.controller.ts:490`: `passwordSetupUrl = "https://tix.swiss-robotics.org/auth/reset?token=${rawToken}&setup=1"`
- `exhibitor-portal.service.ts:632`: Same hard-coded URL for staff invitations

After setting password on the Dashboard form, the user is redirected to `/login` — the **Dashboard login page**, not the event site portal.

**Fix:**
- The password setup URL must point to the event site, not the Dashboard
- The sratix-client WP plugin needs a password setup page/widget at the event site
- Option A: Add a `[sratix_set_password]` shortcode + WP page, construct URL from event `pagePaths`
- Option B: Add a dedicated Server-rendered password setup page that redirects to the portal after success
- The URL should be: `https://swissroboticsday.ch/set-password?token=XXX&setup=1` (configurable)

### Issue 12: Portal login fails / wrong redirect

**Root cause:** The portal at `swissroboticsday.ch/exhibitor-portal/` authenticates via WP identity exchange (`auth/token` endpoint). The exchange sends `wpUserId`, `signature`, `email` to SRAtix Server. This works when the WP user exists. But:
- Exhibitor provisioning creates a SRAtix User — it does NOT create a WP user
- The WP portal widget requires a logged-in WP user (`config.user` must have `email`, `wpUserId`)
- Without a WP user, the portal shows the login prompt → user can't log in on WP side
- **No WP users are created** during exhibitor provisioning — this is the root gap

**Fix:**
- Option A: The outgoing `order.paid` webhook to WordPress should trigger WP user creation (via sratix-control plugin)
- Option B: Add a direct portal login form (email+password → SRAtix API, bypassing WP auth)
- Option C: The password setup completion on the event site triggers WP user creation

### Issue 1: Exhibitor portal "Unable to load"

**Root cause:** Consequence of Issues 11+12. After purchase:
1. Exhibitor is redirected to `swissroboticsday.ch/exhibitor-portal/?sratix_success=1`
2. Portal widget checks for WP logged-in user → none exists
3. Shows "Unable to load" error

**Fix:** Depends on 11+12 fixes.

---

## Phase 2 — Data Correctness

### Issue 5 + 9a: Emails and exhibitor use Stripe card name instead of registration name

**Root cause:** `handleCheckoutComplete()` in `stripe-webhook.controller.ts:121`:
```typescript
customerName: session.customer_details?.name ?? null,  // Stripe card holder name
```
This `customerName` propagates to:
- Order record (`order.customerName`)
- All emails (confirmation, admin notification, gift notification)
- Exhibitor provisioning (`displayName` parameter)
- Exhibitor profile contact name

**Fix:** After `markPaid()`, look up the attendee record linked to the order:
```typescript
const attendee = await this.prisma.attendee.findFirst({
  where: { id: paidOrder.attendeeId },
});
const registrationName = attendee
  ? `${attendee.firstName} ${attendee.lastName}`
  : paidOrder.customerName ?? 'Guest';
```
Use `registrationName` for all downstream references. Keep Stripe name only in payment log fields.

**Files:** `Server/src/payments/stripe-webhook.controller.ts` (lines 121, 143, 258, 286, 297, 307, 313)

### Issue 10: Order confirmation email shows UUID instead of ticket type name

**Root cause:** `stripe-webhook.controller.ts:260`:
```typescript
typeName: item.ticketTypeId,  // Raw UUID! Comment says "Will be resolved" but it's NOT
```

**Fix:** Before building `ticketDetails`, resolve ticket type names:
```typescript
const ttIds = paidOrder.items.map((i: any) => i.ticketTypeId);
const ticketTypes = await this.prisma.ticketType.findMany({
  where: { id: { in: ttIds } },
  select: { id: true, name: true },
});
const ttNameMap = new Map(ticketTypes.map(tt => [tt.id, tt.name]));

const ticketDetails = paidOrder.items.map((item: any) => ({
  typeName: ttNameMap.get(item.ticketTypeId) ?? 'Ticket',
  quantity: item.quantity,
  qrPayload: '',
}));
```

**Files:** `Server/src/payments/stripe-webhook.controller.ts` (lines 258-265)

### Issue 6b + 7: Ticket sold counter never incremented

**Root cause:** `tickets.service.ts` `issueForOrder()` creates Ticket records but never updates `TicketType.sold`. The `sold` field in `TicketType` stays at its default value of 0.

**Fix:** After creating tickets for each OrderItem, increment the sold counter:
```typescript
await this.prisma.ticketType.update({
  where: { id: item.ticketTypeId },
  data: { sold: { increment: item.quantity } },
});
```

**Files:** `Server/src/tickets/tickets.service.ts` (in `issueForOrder()`)

### Issue 4: Registration URL hardcoded to `/register` instead of reading event page paths

**Root cause:** `public-checkout.controller.ts:346`:
```typescript
orderMeta.registrationBaseUrl = new URL(dto.successUrl).origin + '/register';
```
Should use the event's configured page path. The setting exists at `event.meta.pagePaths.register` and the WP admin has it set to `/complete-registration/`.

**Fix:** Read from event meta:
```typescript
const eventMeta = (event.meta as Record<string, any>) ?? {};
const pagePaths = eventMeta.pagePaths ?? {};
const registerPath = pagePaths.register ?? '/complete-registration/';
orderMeta.registrationBaseUrl = new URL(dto.successUrl).origin + registerPath;
```

**Files:** `Server/src/payments/public-checkout.controller.ts` (line 346 and ~467)

### Issue 9b: Staff count shows 0/3 instead of 1/3

**Root cause:** `exhibitor-portal.service.ts:1128`:
```typescript
const staffSubmitted = ee.staff.filter((s) => s.passStatus !== 'pending').length;
```
New staff records have `passStatus: 'pending'`, so they're excluded from the count. But staff were added during registration and their access is paid — they should all be counted.

**Fix:** Display total staff count, not just non-pending:
- Change Dashboard display from `staffSubmitted/maxStaff` to `staffCount/maxStaff`
- The `staffSubmitted` field can still exist for a "confirmed" sub-count if needed

**Files:** `Dashboard/src/app/dashboard/events/[id]/exhibitor-setup/client.tsx` (line 156)

### Issue 8: Purchaser not in attendees list

**Root cause:** Needs DB investigation. The purchaser attendee IS created during checkout in `public-checkout.controller.ts:160-175`. Possible causes:
- Old test data: the attendee record for `office@taros.ro` might exist from an earlier test with different eventId
- The checkout may have matched an existing attendee with same email from a prior test
- If the purchaser already existed with status from old test, the record isn't updated

**Action:** Check live DB. If the purchaser exists, the display issue may be the attendee list filtering or sorting.

---

## Phase 3 — Enhancements

### Issue 2: Admin notification email needs richer data

**Current:** Basic info only (order #, customer, email, total, ticket count, event, date).

**Needed:**
- Ticket type names and quantities (not just count)
- Whether exhibitor order
- Staff added during registration (names + emails from `orderMeta.recipientAttendees`)
- Invoice preference (from order meta)
- Photo/media consent (from attendee/order meta)
- Purchase timestamp in Swiss timezone (Europe/Zurich)
- No emojis in email
- SRAtix sidebar logo in email header (dark bg)

**Files:** `stripe-webhook.controller.ts` (data preparation), `email.service.ts` (template + method signature)

### Issue 3: Ticket codes in emails

**Current state:** Tickets have 12-char codes (e.g. `A7K2M9P4Q6X8`) with HMAC QR payloads. Order confirmation email doesn't include them.

**Fix:** Pass ticket codes from `issueForOrder()` return value to email template. QR image generation is a separate future task.

**Files:** `stripe-webhook.controller.ts`, `email.service.ts`

### Issue 6a: "D-239" countdown format

**Current:** `D-${daysUntil}` format. Functional but unclear to some users.

**Fix:** Change to `${daysUntil} days` or i18n key with readable format.

**Files:** `Dashboard/src/app/dashboard/events/[id]/client.tsx:296`

### Issue 6c: Dollar sign icon for Revenue card

**Current:** `<Icons.DollarSign>` used as Revenue icon. Inappropriate for CHF.

**Fix:** Replace with a currency-neutral icon (coins, banknotes, or generic revenue icon).

**Files:** `Dashboard/src/app/dashboard/events/[id]/client.tsx:278`, `Dashboard/src/components/icons.tsx`

---

## Execution Order

```
Phase 2 (can do now, server-only):
  ├── Issue 5+9a: Registration name instead of Stripe name
  ├── Issue 10: Resolve ticket type name in email
  ├── Issue 6b+7: Increment ticketType.sold
  ├── Issue 4: Registration URL from event page paths
  ├── Issue 9b: Staff count includes pending
  └── Issue 8: Verify purchaser attendee creation

Phase 3 (server + dashboard):
  ├── Issue 6a: Countdown label format
  ├── Issue 6c: Revenue icon
  ├── Issue 2: Enrich admin email
  └── Issue 3: Ticket codes in emails

Phase 1 (cross-system, needs architecture decision):
  ├── Issue 11: Password setup URL → event site
  ├── Issue 12: Portal auth flow (WP user creation gap)
  └── Issue 1: Portal "Unable to load" (depends on 11+12)
```

Phase 1 is listed last in execution because it requires cross-system changes (Server + WP plugin + new WP pages) and an architecture decision on how exhibitor authentication should work. Phases 2 and 3 are server/dashboard-only and can ship immediately.

---

## Key Files Reference

| File | Issues Affected |
|------|----------------|
| `Server/src/payments/stripe-webhook.controller.ts` | 2, 3, 5, 9a, 10, 11 |
| `Server/src/payments/public-checkout.controller.ts` | 4 |
| `Server/src/tickets/tickets.service.ts` | 6b, 7 |
| `Server/src/email/email.service.ts` | 2, 3, 10 |
| `Server/src/exhibitor-portal/exhibitor-portal.service.ts` | 9b, 11 |
| `Dashboard/src/app/dashboard/events/[id]/client.tsx` | 6a, 6c |
| `Dashboard/src/app/dashboard/events/[id]/exhibitor-setup/client.tsx` | 9b |
| `Dashboard/src/components/icons.tsx` | 6c |
| `sratix-client/public/js/sratix-embed.js` | 1, 4, 11, 12 |
| `sratix-client/includes/class-sratix-client-public.php` | 1, 4, 11, 12 |
