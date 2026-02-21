# SRAtix — Comprehensive Upgrade Plan
**Compiled:** 2026-02-20  
**Baseline:** Session 6 / commit `1306cb3` — Phase 1 complete, Phase 2 at 5/14

---

## Scope & Priority Order

| # | Area | Criticality |
|---|------|-------------|
| 1 | Security hardening | 🔴 High — ship-blocker for prod |
| 2 | Public client stubs (sratix-embed.js) | 🔴 High — core product gap |
| 3 | Attendee model enrichment + data quality | 🟠 Medium-High |
| 4 | Ticket lifecycle controls | 🟠 Medium-High |
| 5 | Event creation wizard + new features | 🟡 Medium |
| 6 | Competitive additions (hidden tickets, groups, tracking, multi-track) | 🟡 Medium |
| 7 | Docs & runtime alignment | 🟢 Low — no user impact |
| 8 | Dashboard settings page | 🟠 Medium-High — ops blocker |
| 9 | Remaining Phase 2 items (scanner, email queue, SSE hardening) | 🟡 Medium |
| 10 | Infrastructure / ops hygiene | 🔴 High — prod readiness |

---

## Section 1 — Security Hardening

### 1.1 Token Storage: localStorage → httpOnly Cookies

**Problem**  
`Dashboard/src/lib/auth.tsx` currently stores `sratix_token`, `sratix_refresh_token`, and `sratix_user` in `localStorage`. Any XSS vector in the SPA (injected script, third-party library, etc.) can exfiltrate tokens with `localStorage.getItem()`. The `?token=&refresh=` URL auto-login flow makes this worse — both tokens travel through browser history and can be captured in server access logs, referrer headers, or browser extensions.

**Decision**  
Move access token + refresh token into `httpOnly; Secure; SameSite=Lax` cookies set by the NestJS server. The SPA never accesses raw token values. User identity (id, email, displayName, roles) is kept in a lightweight non-httpOnly `sratix_session` JSON cookie or in-memory React state only (no token values there).

**Implementation Steps**

**Server-side (NestJS)**

1. **`Server/src/auth/auth.controller.ts`** — Update `POST /api/auth/login`, `POST /api/auth/token`, `POST /api/auth/wp-exchange`, and `POST /api/auth/refresh` to set response cookies instead of returning tokens in the JSON body:
   - `accessToken` cookie: `httpOnly: true`, `secure: true` (enforce in production via `NODE_ENV`), `sameSite: 'lax'`, `maxAge: 15 * 60 * 1000` (15 min)
   - `refreshToken` cookie: `httpOnly: true`, `secure: true`, `sameSite: 'lax'`, `maxAge: 7 * 24 * 3600 * 1000` (7 days), **path `/api/auth/refresh`** only to narrow the exposure window
   - Optionally include in JSON body: `{ expiresIn, user: { id, email, displayName, roles } }` (no token values) so the client can build its React state

   Fastify cookie support: install `@fastify/cookie` and register it in `main.ts` before the app starts (`app.register(require('@fastify/cookie'))`).

2. **`Server/src/auth/auth.service.ts`** — Ensure `POST /api/auth/refresh` reads the refresh token from `req.cookies.refreshToken` instead of (only) the JSON body. Keep backward-compat body read during the migration window, then remove.

3. **`Server/src/auth/strategies/jwt.strategy.ts`** — Update `JwtStrategy.validate()` / `PassportStrategy` to extract the bearer token from `req.cookies.accessToken` in addition to the `Authorization: Bearer` header. This lets both dashboard (cookie-based) and API clients (header-based, e.g., WP plugins) work simultaneously.

4. **`POST /api/auth/logout`** — Add explicit logout endpoint that clears both cookies (`res.clearCookie('accessToken'); res.clearCookie('refreshToken')`).

**Dashboard-side (Next.js)**

5. **`Dashboard/src/lib/auth.tsx`** — Remove all `localStorage.setItem/getItem/removeItem` for token keys. The new flow:
   - On `loginWithPassword()`, `loginWithJwt()`, `login()`: call the server, which sets httpOnly cookies. Parse the JSON body to get `{ user, expiresIn }` and store user state in React context only.
   - Schedule auto-refresh (`scheduleRefresh()`) based on `expiresIn` from the API response rather than decoding the JWT client-side.
   - Refresh call at `POST /api/auth/refresh` — no body required; the browser sends the refresh cookie automatically. Response body contains `{ user, expiresIn }`.
   - `logout()`: call the new `POST /api/auth/logout` endpoint (clears server cookies), then clear React state.

6. **`Dashboard/src/lib/api.ts`** — All `request()` calls must include `credentials: 'include'` in `fetch()` options so cookies are sent cross-origin. Remove the `Authorization: Bearer` header injection from `getToken()` — this becomes a no-op or falls back to `Authorization` header only for non-browser clients. The 401-retry logic (currently refreshing the access token and retrying) remains, but the token is refreshed via cookie, not in-memory value.

7. **`Dashboard/src/app/login/page.tsx`** — Remove the `?token=&refresh=` URL parameter auto-login flow. Replace with a **server-side token exchange**:
   - WP Control plugin calls `POST /api/auth/token` (already exists) — server sets cookies, then **redirects the user** to `/dashboard` with cookies already installed. No JWT values ever appear in the URL.
   - `class-sratix-control-api.php`'s `exchange_token()` path therefore changes to: build the HMAC, `POST /auth/token`, and rather than returning a `?token=` redirect URL, the server response is a `302 Location: /dashboard` with `Set-Cookie` headers.

   > ⚠️ **Backward-compatibility note:** The `?token=` flow in `login/page.tsx` currently works and is used in production. Do not remove it until the server-side redirect is confirmed working. A feature flag (`COOKIE_AUTH=true` in `.env`) can gate the new behavior during transition.

8. Remove `decodeJwtPayload()` from `auth.tsx` — no longer needed on the client. Roles come from the server's JSON response body on login.

**`Dashboard/next.config.ts` — Cookie considerations**  
The dashboard is a static export served by the same origin as the API (`tix.swiss-robotics.org`). Since both dashboard SPA and API share the same domain, `SameSite=Lax` cookies will be sent with navigations and XHR/fetch with `credentials: 'include'`. No CORS changes are required for the happy path. Confirm `CORS_ORIGIN` in the NestJS server config allows the dashboard origin.

---

### 1.2 Role Nomenclature Canonicalization

**Problem**  
`Server/src/users/users.service.ts` uses roles `event_admin` and `organization_admin`. `Docs/PRODUCTION-ARCHITECTURE.md` and `Docs/HANDOFF-SESSION-6.md` use `event_manager` and `org_admin`. The `UserRole.role` column is a free `VarChar` — no DB-level enum constraint. This means a typo or inconsistency in any one place can silently grant or deny access.

**Canonical Role Table (to be enforced everywhere)**

| Canonical Name | Purpose | Scope in `UserRole` |
|---|---|---|
| `super_admin` | Platform owner — full access | global (`orgId: null`) |
| `organization_admin` | Full org admin | scoped to `orgId` |
| `event_admin` | Manages specific events | scoped to `orgId` |
| `staff` | Check-in + attendee ops | scoped to `orgId` |
| `scanner` | Check-in only (scanner app) | scoped to `orgId` |
| `volunteer` | Read-only event view | scoped to `orgId` |
| `exhibitor` | Exhibitor booth access | scoped to `orgId` |
| `sponsor` | Sponsor portal access | scoped to `orgId` |
| `partner` | Partner access | scoped to `orgId` |
| `attendee` | End-user self-service | scoped to `orgId` |

**Implementation Steps**

1. **`Server/src/users/users.service.ts`** — Create a `VALID_ROLES` constant `string[]` export and reference it in `getAvailableRoles()`. Any role assignment that doesn't match must throw `BadRequestException`.
2. **`Server/src/auth/guards/roles.guard.ts`** — Enforce only canonical names in `@Roles()` decorator usage. Search for any `@Roles('org_admin')` or `@Roles('event_manager')` and replace with canonical strings.
3. **Documentation** — Update `PRODUCTION-ARCHITECTURE.md` to match the canonical table above. Remove `org_admin` and `event_manager` from all docs.
4. **Migration** — Write a one-time Prisma migration script that `UPDATE user_roles SET role = 'organization_admin' WHERE role = 'org_admin'` and similar for any other variants found in the live DB.

---

### 1.3 QR HMAC Truncation — Document as Intentional Decision

**Current state** (from `Server/src/tickets/tickets.service.ts`):
```
HMAC-SHA256(code, JWT_SECRET:event:{eventId}).substring(0, 16)   // 16 hex = 64 bits
```

**Analysis**  
64-bit truncated HMAC is acceptable for this threat model because:
- The QR code is single-use (status flips to `used` on first scan)
- Constant-time comparison is already used in `verifyQrPayload()`
- An attacker cannot iterate because each attempt triggers a real check-in

**Action**  
Add a comment block in `tickets.service.ts` at the `computeHmac()` method that explicitly states the threat model, the rationale for 16 hex chars, and the mitigations (single-use tickets + constant-time comparison). Also add a brief entry in `PRODUCTION-ARCHITECTURE.md` under security notes.

No code change is required for this item — documentation only.

---

### 1.4 Repo Hygiene

**Items to fix:**

1. **`attrexx-account.txt`** — Move out of the repository entirely. Add to `.gitignore`. If it contains live credentials (API keys, passwords), rotate those credentials immediately. Store in a password manager or `.env` only.
2. **`start.js`** — Orphaned file; no longer referenced by `package.json`. Delete.
3. **`Server/.env`** — Currently gitignored (correct). Add a `Server/.env.example` with all keys and placeholder values if it doesn't already exist.
4. **`STRIPE_WEBHOOK_SECRET`** — Blank in production `.env`. Must be set before payments are considered reliable. See Section 10.

---

### 1.5 GDPR / Privacy Operational Hardening

**Current state:** `GdprModule` exists with erasure, access, and consent endpoints. The `AuditLog` model is append-only. GDPR framework is conceptually correct.

**Gaps to address:**

1. **DSAR (Data Subject Access Request) job** — Add a BullMQ job in `sratix-gdpr` queue that collects all records for a given `email` across `Attendee`, `FormSubmission`, `Ticket`, `Order`, `CheckIn`, `AuditLog` into a structured JSON/CSV export and emails it to the requester. Add `GET /api/gdpr/export/:requestId` status endpoint.
2. **Erasure confirmation** — Current erasure likely nullifies PII fields in-place. Add an `AuditLog` entry of action `gdpr.erasure` for every erasure so there is an immutable record that erasure occurred (without restoring the PII).
3. **Plugin notification failures** — `OutgoingWebhooksService` dispatches hook events; if a WP plugin fails to receive a `ticket.issued` or `attendee.registered` event, the WP site has stale data. The `WebhookDelivery` retry mechanism already exists. Ensure the webhook retry UI in the Dashboard surfaces failed GDPR-relevant deliveries prominently.
4. **Consent field on `Attendee`** — See Section 3.1.

---

## Section 2 — Public Client: Complete the Stubs

This is the most user-visible gap. The `sratix-embed.js` widget renders ticket cards but clicking "Select" does nothing. The "My Tickets" and "Schedule" widgets are placeholders. These must be completed before SRAtix can process registrations.

### 2.1 Ticket Selection → Form → Stripe Checkout Flow

**File:** `sratix-client/public/js/sratix-embed.js`

The complete purchase flow has three stages: **select ticket** → **fill registration form** → **Stripe checkout**. All three stages should happen inline (modal overlay) without a page redirect where possible, to keep the user on the WordPress event page.

**Step-by-step implementation:**

**Stage A — Quantity Selector**

Replace the `alert(...)` stub in `bindTicketActions()` with a modal that shows:
- Ticket type name + price
- Quantity stepper (1 to `maxPerOrder`, respecting `quantity - sold` availability)
- Optional promo code field (calls `GET /api/promo-codes/validate?code=X&eventId=Y&ticketTypeId=Z`)
- "Continue to Registration" button

Functions to add in `sratix-embed.js`:
- `openTicketModal(ticketTypeId, ticketType)` — builds the modal HTML, appends to `<body>`, binds quantity +/- buttons
- `closeModal()` — removes modal overlay
- `validatePromoCode(code, eventId, ticketTypeId)` — async fetch → updates displayed price

**Stage B — Registration Form**

If the event has a `FormSchema` attached to the ticket type, fetch it: `GET /api/events/{eventId}/forms` → find the schema matching `formSchemaId` on the `TicketType`.

Render the form fields dynamically from the `fields: []` JSON array (field types: `text`, `email`, `tel`, `select`, `checkbox`, `radio`). Mandatory built-in fields:
- First name, Last name, Email (always required)
- Any custom fields from `FormSchema.fields`

Functions to add:
- `renderFormModal(ticketType, quantity, promoCode)` — builds form HTML from schema
- `collectFormData(formEl)` — serialises form → returns `{ attendeeData, formSubmission }`
- `validateFormData(data, schema)` — client-side required-field validation

**Stage C — Create Order + Redirect to Stripe**

On form submit, call:
```
POST /api/payments/checkout
{
  eventId,
  ticketTypeId,
  quantity,
  promoCode (optional),
  attendeeData: { firstName, lastName, email, phone, company },
  formData: { [fieldId]: value, ... },
  successUrl: window.location.href + '?sratix_success=1',
  cancelUrl: window.location.href
}
```

The server creates an `Order`, an `Attendee`, a `FormSubmission`, and a Stripe Checkout Session. The response contains `{ checkoutUrl }`. The embed script then does `window.location.href = checkoutUrl`.

On return (`?sratix_success=1`), show a success banner: "🎉 Registration complete! Check your email for your ticket."

**Server-side changes required:**
- `Server/src/payments/payments.controller.ts` — Ensure the checkout endpoint accepts `attendeeData` and `formData` inline (currently it may create the `Order` + `Attendee` separately). If not already combined, merge in the `PaymentsService.createCheckoutSession()` method.
- `Server/src/payments/payments.service.ts` — Pass `successUrl` and `cancelUrl` from the client request into `stripe.checkout.sessions.create()`.

**New API endpoint needed:**
```
GET /api/events/:eventId/ticket-types/:id/public
```
Returns a single ticket type with its form schema fields (public, no auth). Used by the embed to get full ticket details before rendering the form.

---

### 2.2 My Tickets Widget

**File:** `sratix-client/public/js/sratix-embed.js` → `initMyTicketsWidget()`

This widget shows the current user's tickets for the event. It requires authentication — a WP user who purchased tickets needs to see their tickets.

**Flow:**
1. On init, check if the WP user is logged in (available via `sratixConfig.wpNonce` + `sratixConfig.wpUserId` passed from the PHP plugin through `wp_localize_script`).
2. If logged in, call: `POST /api/auth/wp-exchange` with a short-lived HMAC token (constructed by `sratix-client`'s PHP-side, similar to `sratix-control`) to get a SRAtix JWT.
3. Call `GET /api/tickets?eventId={eventId}&attendeeEmail={email}` (scoped by attendee) with the JWT to fetch the user's tickets.
4. Render ticket list: ticket code, type name, status badge (valid/used/voided), QR code image (from `ticket.qrPayload`, rendered via a JS QR library like `qrcode` npm or jsQR in reverse — consider a lightweight CDN-hosted QR generator: `https://api.qrserver.com/v1/create-qr-code/?data={payload}&size=200x200`).
5. "Download Ticket" button: triggers `GET /api/tickets/{id}/pdf` (if implemented) or a wallet pass link.

**Server-side changes:**
- **`Server/src/auth/auth.controller.ts`** — The `POST /api/auth/wp-exchange` endpoint must be callable by the sratix-client plugin with a valid HMAC. `sratix-client` needs to generate its own HMAC the same way `sratix-control` does. Add the webhook secret for `sratix-client` to its `wp_options` row.
- **`GET /api/tickets`** — Add a filter `?attendeeId` or `?attendeeEmail` + `?eventId` to scope tickets to an individual attendee. Ensure this is rate-limited and requires auth.

**PHP side (`sratix-client/includes/class-sratix-client-public.php`):**
- Add `generate_wp_hmac_token()` method (mirrors control plugin).
- Localize `wpUserId`, `wpNonce`, `userEmail` into `sratixConfig`.

---

### 2.3 Schedule Widget

**File:** `sratix-client/public/js/sratix-embed.js` → `initScheduleWidget()`

The schedule widget requires a server-side data model. See Section 6.2 (Multi-Track / Sessions) for the data model. Until that model exists, this widget can render from `Event.meta.schedule` (a freeform JSON array stored in the event's `meta` field) as a minimal v1.

**Minimal v1 approach:**
- Admin manually adds `schedule` JSON to `Event.meta` via the Dashboard Event Settings page.
- Embed reads `GET /api/events/{eventId}/public` (add a public event detail endpoint) which includes `meta.schedule`.
- Render a day-group timeline: time slot → session title → speaker name → room.

This is a low-investment path that unblocks the placeholder immediately without new DB models.

---

## Section 3 — Attendee Data Model Enrichment & Data Quality

### 3.1 Extended Attendee Profile Fields

**Problem**  
`Attendee` model has: `email`, `firstName`, `lastName`, `phone`, `company`, `meta`. For B2B/academic conferences, operators need dietary preferences, accessibility requirements, badge display names, org role, and explicit consent records.

**Prisma schema changes (`Server/prisma/schema.prisma`):**

Add the following to the `Attendee` model (all nullable, backward-compatible):
```
badgeName         String?   @db.VarChar(100)   // preferred name for badge
jobTitle          String?   @db.VarChar(150)
orgRole           String?   @db.VarChar(100)   // e.g. "CTO", "Researcher"
dietaryNeeds      String?   @db.VarChar(255)   // free text or enum values
accessibilityNeeds String?  @db.VarChar(255)
consentMarketing  Boolean   @default(false)
consentDataSharing Boolean  @default(false)
consentTimestamp  DateTime?
tags              Json?     // admin-applied string tags for filtering
```

Generate a migration: `npx prisma migrate dev --name add_attendee_profile_fields`

**API changes:**
- `Server/src/attendees/attendees.service.ts` — Update `create()` and `update()` to accept the new fields.
- `Server/src/attendees/attendees.controller.ts` — Update DTOs (`CreateAttendeeDto`, `UpdateAttendeeDto`) to include new fields.
- `Server/src/export/export.service.ts` — Update CSV attendee export to include new columns.

**Dashboard changes:**
- `Dashboard/src/app/dashboard/events/[id]/attendees/client.tsx` — Update the attendee detail panel / edit modal to show and edit the new fields.
- Add a Tags column to the attendee DataTable with filter support.

---

### 3.2 Duplicate Attendee Detection

**Problem**  
No mechanism prevents the same person from registering twice under slightly different names (`john.doe@co.com` vs `johndoe@co.com`) or with a typo.

**Implementation:**

**Server-side:**  
In `AttendeesService.create()`, before inserting, query for existing attendees in the same event with:
1. **Exact email match** (`@@unique([eventId, email])` already enforces this at DB level — ensure the error is surfaced as `409 Conflict` with message `"An attendee with this email is already registered for this event."`)
2. **Fuzzy name match** — after exact dedup, check `SELECT * FROM attendees WHERE eventId = ? AND similarity(email, ?) > 0.8 OR (firstName LIKE ? AND lastName LIKE ?)`. MariaDB does not have built-in trigram similarity for strings — use a JS implementation of Levenshtein distance in the service to score candidate duplicates, returning them as a warning in the response body.

**API response shape for potential duplicate:**
```json
{
  "status": "duplicate_warning",
  "existingAttendee": { "id": "...", "email": "...", "name": "..." },
  "message": "A similar attendee already exists. Confirm to proceed."
}
```

The dashboard can show a confirmation dialog. Add a `force: true` param to bypass the warning.

**Dashboard:**  
- `Dashboard/src/app/dashboard/events/[id]/attendees/client.tsx` — Handle `409` and `duplicate_warning` responses; show an inline confirmation banner with a "Register Anyway" button.

---

### 3.3 Error Handling Toasts

**Problem**  
Several `catch` blocks in dashboard pages are intentionally silent (`catch { /* silent */ }`). This makes it very hard for operators to diagnose issues.

**Fix:**  
Create a global toast notification context: `Dashboard/src/components/toast.tsx` + `Dashboard/src/hooks/use-toast.ts` (or use a lightweight library like `sonner` which is Tailwind-compatible and tiny). Wrap `Dashboard/src/app/layout.tsx` with `<Toaster />`.

Replace all silent catches in:
- `Dashboard/src/app/dashboard/page.tsx` (events `loadEvents` catch)
- `Dashboard/src/app/dashboard/events/[id]/attendees/client.tsx`
- `Dashboard/src/app/dashboard/events/[id]/orders/client.tsx`
- Any other client pages

Pattern:
```tsx
// Before:
} catch { /* silent */ }

// After:
} catch (err) {
  toast.error(err instanceof Error ? err.message : 'An unexpected error occurred');
}
```

---

## Section 4 — Ticket Lifecycle Controls

### 4.1 Status Enum Hardening + Transition Guards

**Problem**  
`Ticket.status` is a `VarChar(30)` with values `valid | used | voided`. There are no server-side guards on which transitions are allowed.

**Allowed transition matrix:**

| From | To | Allowed By |
|------|----|------------|
| `valid` | `used` | Check-in (scanner / manual) |
| `valid` | `voided` | Admin with void reason |
| `used` | `voided` | Super Admin only (override) |
| `voided` | — | No re-activation (append-only audit trail) |

**Implementation:**

1. **`Server/src/tickets/tickets.service.ts`** — Add a `TICKET_TRANSITIONS` constant (map of `from → Set<to>`). Before any status update, call `validateTransition(currentStatus, newStatus, actorRole)` which throws `BadRequestException` if the transition is not allowed.
2. **`void()` method** — Require a `reason: string` parameter (not nullable). Persist reason in `AuditLog.detail.reason`. Add `voidReason String? @db.VarChar(500)` to the `Ticket` model or store in `meta`.
3. **`TicketType.status`** — Apply a similar enum + guard:
   - `draft → active`: admin explicitly publishes
   - `active → paused`: admin pauses sales
   - `paused → active`: admin resumes
   - `active → sold_out`: automatic when `sold >= quantity`
   - `sold_out → active`: automatic if quantity is raised
   - `active/paused → archived`: admin archives
 
   Add `validateTicketTypeTransition()` in `Server/src/ticket-types/ticket-types.service.ts`.

---

### 4.2 Reservation / Hold Windows

**Problem**  
Currently, a ticket is only issued after Stripe payment completes. If Stripe Checkout takes 10 minutes and inventory is limited, multiple users can start checkout for the last ticket simultaneously.

**Implementation:**

1. **`TicketType` model** — Add `reservedCount Int @default(0)`. This counter increments when a Stripe Checkout session is created and decrements when it expires or completes.
2. **Availability check** — `availableCount = quantity - sold - reservedCount`. Reject checkout creation if `availableCount <= 0`.
3. **Stripe Checkout expiry** — Stripe sessions expire after 30 minutes by default (`expires_after: 1800`). Add a BullMQ delayed job (`sratix-reservation-release`) that fires at session expiry time to decrement `reservedCount` if the order never reached `paid` status.
4. **`Server/src/payments/payments.service.ts`** — On `createCheckoutSession()`, increment `reservedCount`; on `handleCheckoutComplete()`, decrement `reservedCount` and increment `sold`. On session expiry webhook (`checkout.session.expired`), decrement `reservedCount`.

---

### 4.3 Waitlist with Auto-Promotion

**Prisma schema addition:**
```prisma
model WaitlistEntry {
  id           String   @id @default(uuid()) @db.Char(36)
  eventId      String   @db.Char(36)
  ticketTypeId String   @db.Char(36)
  email        String   @db.VarChar(255)
  firstName    String   @db.VarChar(100)
  lastName     String   @db.VarChar(100)
  position     Int      // ordering within waitlist
  notifiedAt   DateTime?
  expiresAt    DateTime? // if user was offered a ticket and hasn't paid
  status       String   @default("waiting") @db.VarChar(30) // waiting | offered | purchased | expired
  createdAt    DateTime @default(now())

  event       Event      @relation(...)
  ticketType  TicketType @relation(...)

  @@unique([ticketTypeId, email])
  @@index([ticketTypeId, status, position])
  @@map("waitlist_entries")
}
```

**`Server/src/waitlist/`** — New NestJS module with:
- `POST /api/events/:id/ticket-types/:ttid/waitlist` — public endpoint to join waitlist
- `GET /api/events/:id/waitlist` — admin view
- `WaitlistService.promoteNext(ticketTypeId)` — called by `TicketsService` when a ticket is voided or a reservation expires; finds the top `waiting` entry, marks it `offered`, sets `expiresAt = now + 24h`, sends promotion email, dispatches `outgoing-webhooks` event `waitlist.promoted`.
- BullMQ delayed job `sratix-waitlist-expire`: if the user doesn't complete checkout within 24h, mark `expired` and promote the next person.

**`Dashboard`** — Add a Waitlist tab in the Ticket Types management page showing waiting count + offered count per ticket type. Allow admin to manually promote or remove entries.

---

### 4.4 Ticket Transfer / Reassignment

**Use case:** Attendee A cannot attend and wants to transfer their ticket to Attendee B.

**Flow:**
1. Admin visits attendee's ticket record in Dashboard, clicks "Transfer Ticket."
2. Inputs new attendee email + name.
3. If the new email already has an `Attendee` record for this event, reassign to that record. Otherwise, create a new `Attendee`.
4. Update `Ticket.attendeeId`, log `AuditLog` entry `ticket.transferred`, update badge if rendered.

**`Server/src/tickets/tickets.service.ts`** — Add `transfer(ticketId, { newEmail, newFirstName, newLastName }, actorId)` method.  
**New endpoint:** `POST /api/tickets/:id/transfer` (requires `event_admin` role).

---

## Section 5 — Event Creation Enhancement

### 5.1 Wizard-Style Event Creation

**Problem**  
The current create-event modal in `Dashboard/src/app/dashboard/page.tsx` is a single-step form. For production admins setting up real conferences, this becomes overwhelming and leaves critical settings (VAT, invoicing, check-in policy, visibility) unconfigured until later — or never.

**Approach:** Convert the modal to a 4-step wizard. Create a dedicated route `/dashboard/events/new` (with `page.tsx` + `client.tsx`) so deep-links and browser-back work correctly.

**Wizard Steps:**

**Step 1 — Basics**
- Event name (required), URL slug (auto-generated), type (conference | workshop | meetup | exhibition | custom)
- Start date/time, End date/time, timezone selector
- Venue name, venue address

**Step 2 — Configuration**
- Currency (CHF / EUR / USD / GBP)
- Tax mode: `none` | `included` (Swiss MWST) | `exclusive` (shown separately on invoice)
- VAT rate: 0% / 8.1% (Swiss standard) / 3.8% (Swiss hotel) / 2.6% (Swiss reduced) — or custom
- Invoice profile: select from org invoice templates (name, address, UID, bank details) — stored in `Organization.meta.invoiceProfiles`
- Max total capacity (optional)

**Step 3 — Policies & Visibility**
- Publication state: `draft` (admin only) | `published` (public)
- Visibility: `public` | `unlisted` (via direct link only) | `private` (invite only)
- Check-in policy: `any_ticket` (default) | `by_zone` (requires zone assignment on ticket types)
- Ticket sales window: open immediately | open on specific date/time

**Step 4 — Communications**
- Event contact email (for attendee reply-to)
- Confirmation email subject line template
- Enable/disable reminder emails (D-7, D-1)
- (Optional) Custom confirmation message shown on order success page

These step 2–4 fields are stored primarily in `Event.meta` (flexible JSON) to avoid a schema migration per field. The server's `EventsService.create()` and `update()` methods already accept `meta` as a passthrough field.

**Dashboard implementation:**
- New file: `Dashboard/src/app/dashboard/events/new/client.tsx` with a step state machine (`step: 1 | 2 | 3 | 4`), a progress bar, and Back/Next/Create buttons.
- The existing "New Event" modal in `dashboard/page.tsx` becomes a simple "Create Event →" button that navigates to `/dashboard/events/new`.
- The existing quick-create modal can remain as a "Quick Create" shortcut for power users (name + dates only).

---

### 5.2 Hidden Tickets (Access Codes / Unlockable Ticket Types)

**Use case:** VIP tickets, speaker tickets, early access — not shown publicly but available via a code.

**Prisma schema changes to `TicketType`:**
```
visibility   String  @default("public") @db.VarChar(20) // public | unlisted | private
accessCode   String? @db.VarChar(100)  // if set, ticket type only visible when code matches
```

**Public ticket list endpoint (`GET /api/events/:id/ticket-types/public`):**
- Returns only `visibility = 'public'` ticket types by default.
- Accepts optional query param `?accessCode=XYZ`. If provided, also returns ticket types where `accessCode = 'XYZ'` (case-insensitive, constant-time comparison to prevent timing oracle).

**Embed widget:**
- `initTicketsWidget()` in `sratix-embed.js` — check for `sratixConfig.accessCode` (can be passed via shortcode attribute `[sratix_tickets access_code="VIP2026"]`) and append to the public API call.
- Alternatively, add an "I have an access code" input on the ticket selection widget that re-fetches the ticket list with the code.

**Dashboard:**
- Ticket type form — add "Visibility" select and "Access Code" text input.

---

### 5.3 Group Discounts

**Use case:** "Register 5+ people and get 15% off" — common in B2B/academic conferences.

**Approach:** Extend the existing `PromoCode` model — group discounts are promo codes that auto-apply when `quantity >= threshold`.

**New `PromoCode` fields:**
```
minimumQuantity  Int?       // auto-apply when order quantity >= this
groupLabel       String?    @db.VarChar(100)  // shown in checkout as "Group Rate"
```

**`Server/src/promo-codes/promo-codes.service.ts`** — In `validateForCheckout()`, auto-apply any promo code with `minimumQuantity` that is not expired and not over usage limit when the order quantity threshold is met. Surface this as `{ autoApplied: true, label: "Group Rate (5+)" }` in the checkout response.

**Stripe integration:** Group discount is handled as a percentage off the line item, identical to existing promo code discount mechanics. No new Stripe objects needed.

---

### 5.4 Multi-Day / Multi-Track / Session Add-ons

**Use case:** Conference with Day 1 General + Day 2 Workshop + optional Dinner ticket — or parallel tracks.

**Data model approach — parent/child events:**

Add to `Event` model:
```
parentEventId  String?  @db.Char(36)   // null = top-level event; set = sub-event/session
sessionType    String?  @db.VarChar(50)  // day | track | workshop | dinner | addon
sortOrder      Int      @default(0)
```

A "Swiss Robotics Day 2026" parent event has child events:
- "Day 1 — Main Conference" (sessionType: `day`)
- "Day 2 — Workshop" (sessionType: `workshop`, separate ticket)
- "Gala Dinner" (sessionType: `addon`)

Sub-events have their own `TicketType` records. An attendee purchasing a sub-event ticket is linked to both the sub-event and the parent event via `Attendee.eventId` (pointing to the sub-event) **and** a `meta.parentEventId` field.

**Alternative (simpler) approach for immediate needs:** Use `TicketType` categorization only — add a `category` field (`String? @db.VarChar(100)`, e.g., "Day 1 Pass", "Workshop", "Add-on") and a `sortOrder Int @default(0)`. The embed widget groups ticket types by category. No new Event records needed.

> **Recommendation:** Start with the `TicketType.category` + `sortOrder` approach (no schema change beyond adding two fields). The parent/child event model is the full long-term solution but requires significant API and dashboard work.

---

## Section 6 — Competitive Features

### 6.1 Affiliate / Campaign Tracking

**Use case:** Track which marketing campaign, partner link, or affiliate drove each ticket sale.

**New `PromoCode` fields (or separate table):**
```
trackingCode    String?  @db.VarChar(100)   // UTM campaign / affiliate ID
```

**`Order` model:**
```
utmSource     String?  @db.VarChar(100)
utmMedium     String?  @db.VarChar(100)
utmCampaign   String?  @db.VarChar(100)
referredBy    String?  @db.VarChar(100)   // affiliate ID / partner code
```

**Flow:**
1. Embed widget reads UTM params from `window.location.search` on load.
2. Passes `{ utmSource, utmMedium, utmCampaign }` in the checkout POST body.
3. `PaymentsService.createCheckoutSession()` stores UTM data on the `Order` record.
4. Analytics dashboard page adds a "Traffic Sources" card showing orders grouped by `utmCampaign`.

**Dedicated module (optional full build):** `Server/src/affiliate/` — CRUD for affiliate links, per-affiliate revenue dashboard, payout tracking. This is a Phase 3 item.

---

## Section 7 — Documentation & Runtime Alignment

### 7.1 README Rewrite

**File:** `README.md`

Current README describes a "hosting capability tester." This will mislead every new developer, auditor, or integration partner.

Rewrite with:
- What SRAtix is (1-paragraph overview)
- Architecture overview (Next.js SPA + NestJS API + MariaDB + Redis + BullMQ)
- Prerequisites (Node.js 24, MariaDB 10.6, Upstash Redis)
- Setup: `npm install` → configure `.env` files → `npx prisma migrate deploy` → `npm run build` → `npm start`
- Deployment: Infomaniak git push flow
- Plugin summary: `sratix-control` (swiss-robotics.org) + `sratix-client` (swissroboticsday.ch)
- Link to `Docs/PRODUCTION-ARCHITECTURE.md`

---

### 7.2 Role Naming Throughout Docs

Cross-check and update:
- `Docs/PRODUCTION-ARCHITECTURE.md` — Replace `org_admin` → `organization_admin`, `event_manager` → `event_admin`
- `Docs/HANDOFF-SESSION-6.md` and all other handoff docs — same substitutions
- Any `@Roles(...)` decorator calls in Server source
- `Dashboard/src/lib/api.ts` `RoleDefinition` type — match canonical names
- `sratix-control/includes/class-sratix-control-api.php` — if roles are hardcoded in the HMAC payload construction, verify canonical names are used

---

### 7.3 sratix-control Class Naming

`sratix-control/includes/class-sratix-control-api.php` contains `SratixControlApi` class. `PRODUCTION-ARCHITECTURE.md` refers to the API bridge as `SratixApiClient`. These should be aligned. Update the doc to reference the actual class name, or rename the class in the PHP file (lower-risk: update the doc).

---

### 7.4 Static Export Dashboard Tradeoffs Review

**File:** `Dashboard/next.config.ts` (`output: 'export'`)

Static export was chosen because Infomaniak shared Node.js hosting runs a single process. The tradeoffs for an **authenticated admin app** are:

| Issue | Risk | Mitigation |
|-------|------|------------|
| All routes pre-rendered as HTML at build time | None for auth (SPA guards work client-side) | `AuthGuard` in each page component already redirects unauthenticated users |
| No server-side secret handling | ✅ All secrets stay on NestJS server | Never put secrets in `NEXT_PUBLIC_*` vars |
| Static assets cached by CDN/browser | Out-of-date JS served after deploy | Set `Cache-Control: no-cache` on the NestJS static handler for `*.html` files; immutable caching only for hashed JS/CSS |
| `generateStaticParams` required for `[id]` routes | Architectural constraint; current `_` workaround works | Document the pattern in each `page.tsx` as a comment |

**Immediate action:** Add `Cache-Control: no-cache, no-store` header for `*.html` files in the NestJS `@fastify/static` configuration (`setHeaders` option) so that after a deploy, browsers always refetch the HTML shell.

---

## Section 8 — Dashboard Settings Page

**Status:** `Dashboard/src/app/dashboard/settings/` directory exists but is a stub.

**This is an ops blocker** — without a settings UI, Stripe keys, SMTP credentials, and other critical config must be changed via SSH `.env` editing and a full redeploy.

**Server:** `SettingsModule` + `PATCH /api/settings` already exist. The settings are stored in the `Setting` table with scope `global | org | event`.

**Required settings groups:**

**Group: Email (SMTP)**
- `smtp_host`, `smtp_port`, `smtp_secure` (true/false), `smtp_user`, `smtp_pass`, `smtp_from_name`, `smtp_from_email`
- "Send test email" button → `POST /api/settings/test-email` (new endpoint)

**Group: Stripe**
- `stripe_publishable_key`, `stripe_secret_key`, `stripe_webhook_secret`
- These are high-sensitivity admin credentials — require Super Admin role. Mask values on display (`sk_live_...` shown as `sk_live_•••••••••••`)
- "Verify Stripe connection" button → `POST /api/settings/test-stripe`

**Group: Organization**
- Organization name, logo URL, contact email
- Invoice profile: legal name, address, VAT UID, IBAN/bank details (stored in `Organization.meta.invoiceProfile`)

**Group: Platform**
- `app_url`, `support_email`, `gdpr_contact_email`
- Timezone default for new events

**Dashboard implementation:**
- `Dashboard/src/app/dashboard/settings/client.tsx` — Standard `page.tsx` + `client.tsx` split. Tab navigation between groups. Each group is a form card with save button + last-saved timestamp.
- Use `api.getSettings()` and `api.updateSettings()` from `api.ts` (already typed).

---

## Section 9 — Remaining Phase 2 Items

### 9.1 Check-in Scanner Page (Camera QR)

**Route:** `Dashboard/src/app/dashboard/events/[id]/scanner/`

This page is designed for use on tablets/phones at event entrances. It needs:
- Camera feed via `getUserMedia()` + a JS QR scanner library (`@zxing/browser` or `jsQR`)
- Real-time decode → `POST /api/check-ins` with `{ ticketCode, method: 'qr_scan', deviceId }`
- Visual + audio feedback: green flash + chime for valid, red flash + buzz for invalid/already-used
- Offline mode: store scan attempts in `IndexedDB`, sync when connectivity returns (server already accepts `offline: true` flag on `CheckIn`)
- This page should **not** require full dashboard auth — a `scanner` role user logs in with minimal permissions

---

### 9.2 Email Queue Integration

**Current state:** Emails are sent synchronously via `EmailModule` → Nodemailer. SMTP credentials are blank in production.

**Steps:**
1. Configure SMTP via the Dashboard Settings page (Section 8).
2. Move all email sends to the `sratix-email` BullMQ queue (processor already scaffolded). `EmailService.send()` should enqueue a job, not call Nodemailer directly.
3. The queue processor calls Nodemailer asynchronously with retry (3 attempts, exponential backoff).
4. Add a `GET /api/settings/email-queue-stats` endpoint that returns BullMQ job counts for the dashboard queue monitoring page.

---

### 9.3 SSE Scaling (Redis Pub/Sub)

**Current state:** `SseModule` uses in-process event emitter. Works for a single Node.js process but breaks under horizontal scaling or process restarts.

**Immediate mitigation** (single-process Infomaniak): No change needed.

**Upgrade path (if moving to Cloud Server + PM2 cluster):**
- Replace in-process emitter in `Server/src/sse/sse.service.ts` with Upstash Redis Pub/Sub (`ioredis` already installed).
- Each SSE client subscribes to a channel `sratix:{eventId}:updates`.
- Event emitters publish to Redis; all process instances receive and forward to their subscribed SSE clients.

---

### 9.4 Badge Template Editor UI

**Status:** `BadgeTemplatesModule` is live on the server. Dashboard UI is not built.

**Route:** `Dashboard/src/app/dashboard/events/[id]/badges/`

Minimal v1: a form to create/edit a badge template with:
- Name, dimensions (A4 / A6 / ID card), orientation
- Field mapping: drag-drop or select `attendee.firstName`, `attendee.lastName`, `attendee.company`, `ticket.type`, `ticket.code`, `ticket.qrCode`
- Color/font picker (stored in `layout` JSON)
- Preview button → calls `POST /api/badge-templates/:id/render` and shows rendered image
- Bulk render button → queues all tickets for badge generation

---

## Section 10 — Infrastructure / Ops Hygiene

### 10.1 Critical Production Config (Fix Immediately)

| Item | File | Action |
|------|------|--------|
| `STRIPE_WEBHOOK_SECRET` blank | `Server/.env` | Register a Stripe webhook endpoint at `https://tix.swiss-robotics.org/api/payments/stripe/webhook` in Stripe Dashboard → copy the signing secret → set in `.env` → redeploy. Without this, the `handleCheckoutComplete()` handler is not called and tickets are never issued. |
| All SMTP vars blank | `Server/.env` | Configure via Dashboard Settings (Section 8) or SSH. Until configured, no confirmation emails are sent. |
| Super Admin seed not run | Server | SSH into Infomaniak, run `node -e "require('./dist/prisma/seed.js')"` or the equivalent seed command to create the first Super Admin account. |
| `attrexx-account.txt` in repo | Repo root | Remove from repo, rotate credentials if they were ever pushed to a remote. |
| `start.js` orphaned | Repo root | Delete. |

---

### 10.2 `Cache-Control` for Static HTML

**File:** `Server/src/main.ts` — `@fastify/static` setup

Add `setHeaders` to prevent browsers from caching the Next.js HTML shell:
```typescript
// In the fastify static registration for Dashboard/out/:
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '..', '..', 'Dashboard', 'out'),
  setHeaders(res, path) {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    // Hashed JS/CSS files can be immutably cached
  }
});
```

---

### 10.3 Health Check Expansion

**Current:** `GET /api/health` returns `{ status: 'ok' }`.

**Expand to:**
```json
{
  "status": "ok",
  "db": "connected",
  "redis": "connected",
  "smtp": "configured | not_configured",
  "stripe": "configured | not_configured",
  "timestamp": "2026-02-20T10:00:00.000Z"
}
```

This allows a simple uptime monitor to detect partial failures (e.g., Redis disconnected but app still running).

---

## Checklist Summary

### Priority 1 — Security
- [ ] 1.1 Migrate token storage to httpOnly cookies (server + dashboard)
- [ ] 1.1 Update WP Control plugin to use server-side redirect instead of `?token=` URL
- [ ] 1.2 Canonicalize role names everywhere + add VALID_ROLES constant
- [ ] 1.2 Write + run DB migration to normalize any legacy role values
- [ ] 1.3 Document QR HMAC truncation rationale in code + architecture doc
- [ ] 1.4 Remove `attrexx-account.txt` from repo, rotate credentials
- [ ] 1.4 Delete `start.js`
- [ ] 1.5 Add DSAR export job + erasure audit log entry

### Priority 2 — Public Client Stubs
- [ ] 2.1 `bindTicketActions()` — quantity modal → form modal → Stripe checkout
- [ ] 2.1 Add `GET /api/events/:id/ticket-types/:id/public` endpoint
- [ ] 2.1 `PaymentsService` — accept inline `attendeeData` + `formData` + `successUrl`/`cancelUrl`
- [ ] 2.2 `initMyTicketsWidget()` — WP user auth → ticket list + QR
- [ ] 2.2 PHP side: add `generate_wp_hmac_token()` to `sratix-client`
- [ ] 2.3 `initScheduleWidget()` — render from `Event.meta.schedule` (v1)

### Priority 3 — Attendee Model
- [ ] 3.1 Add profile fields to `Attendee` model + migration
- [ ] 3.1 Update DTOs, exports, dashboard attendee panel
- [ ] 3.2 Implement duplicate detection in `AttendeesService.create()`
- [ ] 3.3 Add toast notification system + replace all silent catches

### Priority 4 — Ticket Lifecycle
- [ ] 4.1 Add `validateTransition()` guard + void reason field
- [ ] 4.1 `TicketType` status transition guards
- [ ] 4.2 Add `TicketType.reservedCount` + BullMQ reservation release job
- [ ] 4.3 New `WaitlistEntry` model + `WaitlistModule` + auto-promotion
- [ ] 4.4 `POST /api/tickets/:id/transfer` endpoint + dashboard UI

### Priority 5 — Event Creation + Features
- [ ] 5.1 Wizard-style event creation at `/dashboard/events/new`
- [ ] 5.2 `TicketType.visibility` + `accessCode` + embed access code input
- [ ] 5.3 `PromoCode.minimumQuantity` for group discounts
- [ ] 5.4 `TicketType.category` + `sortOrder` for multi-session grouping

### Priority 6 — Competitive
- [ ] 6.1 UTM fields on `Order` + embed UTM capture + analytics card
- [ ] 6.1 (Phase 3) Full affiliate module

### Priority 7 — Docs
- [ ] 7.1 Rewrite `README.md`
- [ ] 7.2 Normalize role names in all docs
- [ ] 7.3 Align `class-sratix-control-api.php` class name reference in docs
- [ ] 7.4 Add `Cache-Control: no-cache` for HTML in static server

### Priority 8 — Settings Page
- [ ] 8.1 Build `Dashboard/src/app/dashboard/settings/client.tsx`
- [ ] 8.1 Add `POST /api/settings/test-email` + `POST /api/settings/test-stripe`
- [ ] 8.1 Organization invoice profile in `Organization.meta`

### Priority 9 — Phase 2 Completion
- [ ] 9.1 Scanner page with camera QR + IndexedDB offline sync
- [ ] 9.2 Move email sends to BullMQ queue
- [ ] 9.3 (Deferred) SSE Redis Pub/Sub on Cloud Server upgrade
- [ ] 9.4 Badge template editor UI

### Priority 10 — Ops Hygiene
- [ ] 10.1 Set `STRIPE_WEBHOOK_SECRET` in production `.env`
- [ ] 10.1 Configure SMTP in production `.env`
- [ ] 10.1 Run Super Admin seed on production DB
- [ ] 10.2 Add `Cache-Control` headers for static HTML files
- [ ] 10.3 Expand health check endpoint

---

## Technical Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Token storage | httpOnly cookies | Eliminates XSS token theft; same-origin deployment makes this straightforward |
| WP bridge redirect | Server-side 302 redirect after `POST /auth/token` | Tokens never appear in browser URL/history |
| Role canonicalization | `organization_admin` / `event_admin` (snake_case full names) | Matches current `users.service.ts` and DB values; avoids ambiguity |
| Duplicate detection | JS Levenshtein in service (not DB trigrams) | MariaDB 10.6 lacks trigram extension; service-layer is sufficient at current scale |
| Waitlist | New `WaitlistEntry` table | Cleaner than storing in `Attendee.meta`; enables proper ordering + status tracking |
| Group discounts | Extend `PromoCode` with `minimumQuantity` | Reuses existing promo code mechanics + Stripe line item discount logic |
| Multi-session support (v1) | `TicketType.category` + `sortOrder` | No new Event records; lower risk; parent/child events are Phase 3 |
| Access codes | `TicketType.visibility` + `accessCode` in ticket type | Simple; no new table; constant-time comparison on public API |
| Schedule widget v1 | `Event.meta.schedule` JSON | Unblocks placeholder without new DB models |
| Static export cache | `Cache-Control: no-cache` on `.html` files only | Hashed JS/CSS remains immutably cached; only the SPA shell is bypassed |
