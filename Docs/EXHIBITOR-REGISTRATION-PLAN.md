# Exhibitor Registration Flow & Ticket Segregation

> **Date:** 2026-03-10
> **Status:** 📋 Planning
> **Author:** TAROS Web Services / AI Architecture Session (Session 8)

---

## Overview

Add a **Visitor / Exhibitor role choice screen** as the very first step of the SRAtix registration flow on swissroboticsday.ch. Based on the visitor's choice, route them through the existing SRA / RobotX member gate (discounts apply to both audiences) but showing **only their respective ticket types** on the ticket card screen.

Introduce `'exhibitor'` as a new ticket category (`TICKET_CATEGORIES`) and a corresponding Dashboard TicketKind. Exhibitor ticket purchase uses a **3-step registration wizard** inside a modal:

1. **Purchaser details** — same fields as regular tickets
2. **Company information** — logo, WYSIWYG description, website
3. **Staff passes** *(optional)* — exhibitors may provide staff details now _or_ defer to the **Exhibitor Portal**

Staff who _are_ entered at checkout are handled by the existing multi-recipient pattern (`additionalAttendees`): each staff member receives an attendee record, a registration token, and a gift email.

---

## What is the Exhibitor Portal?

A dedicated self-service area available to each exhibitor after purchase. Provides management of:

- Company profile & media (richer than what is collected at checkout)
- Exhibitor staff (add / remove up to the max allowed by the ticket)
- Booth selection & floor plan
- Lead capture data
- Badge / check-in details

> The Exhibitor Portal is **out of scope** for this plan and will be developed separately. However, the data model and checkout flow designed here must anticipate it — hence staff entry at checkout is **optional** and the informational note in the wizard directs exhibitors to the portal for fuller management.

---

## Decisions Log

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Role choice placement | First screen, before member gate. Both visitors and exhibitors proceed to the SRA / RobotX member gate for discounts. |
| 2 | Ticket category | New `'exhibitor'` value added to `TICKET_CATEGORIES` (4th, alongside `general`, `individual`, `legal`). Visitor flow shows non-exhibitor tickets; exhibitor flow shows exhibitor-only tickets. |
| 3 | Dashboard TicketKind | 3rd radio option `'exhibitor'` alongside Regular and Membership. |
| 4 | Staff handling | Reuses multi-recipient pattern (`additionalAttendees`). Staff get attendee records, registration tokens, and gift emails — same as existing multi-ticket recipient flow. |
| 5 | Staff entry timing | **Optional at checkout.** Exhibitors may skip staff entry entirely and add staff later via the Exhibitor Portal (up to `meta.maxStaff`). |
| 6 | Max staff config | Configured in **form schema meta** (`meta.maxStaff`), not on TicketType. Shown to the user in the staff sub-step. |
| 7 | Exhibitor ticket quantity | Always 1 per purchase (one booth package per order, enforced at checkout). |
| 8 | Company description | New `richtext` field type — vanilla JS port of the Dashboard's `rich-text-editor.tsx` (`contentEditable` + `document.execCommand`). |
| 9 | Registration form layout | **3-step wizard** sub-steps within the registration modal, with a step progress indicator. |
| 10 | Role choice UI | Two big buttons matching the member gate visual style (Visitor / Exhibitor). |

---

## Scope

### Included

- Role choice screen (frontend)
- Exhibitor ticket category (Server + Dashboard + Client)
- Exhibitor 3-step registration wizard (Client)
- `richtext` field type for company description (Client + Server form validation)
- Optional staff fields with multi-recipient reuse (Client + Server)
- Form schema `meta.maxStaff` support
- i18n keys for all new UI elements (5 locales: EN, DE, FR, IT, ZH-TW)
- Template seed update (template 6 already exists — update category to `'exhibitor'`, field type to `'richtext'`)

### Excluded (future — Exhibitor Portal & beyond)

- Exhibitor Portal self-service area (staff management, media uploads, booth selection, floor plan, lead capture)
- Exhibitor listings / dedicated company space on the SRD website
- Exhibitor Dashboard portal (admin-side exhibitor management)
- Badge scanning / lead capture features

---

## Phase 1 — Server: Ticket Category Extension

### 1.1 Add `'exhibitor'` to `TICKET_CATEGORIES`

**File:** `Server/src/ticket-types/ticket-types.service.ts`

```typescript
export const TICKET_CATEGORIES = ['general', 'individual', 'legal', 'exhibitor'] as const;
```

- No migration needed — `category` column is `VARCHAR(30)`, not an enum.
- `getMeta()` endpoint auto-exposes the updated const to the Dashboard.

### 1.2 Add `'richtext'` form field type

**File:** `Server/src/forms/forms.service.ts`

- Add `'richtext'` to the accepted field types in validation.
- During `validateSubmission()`, **sanitize** richtext input:
  - Strip dangerous tags/attributes (`<script>`, `onclick`, etc.).
  - Allow only safe HTML: `b`, `i`, `u`, `strong`, `em`, `a[href]`, `ul`, `ol`, `li`, `p`, `br`.
- **Dependency:** add `sanitize-html` npm package (well-maintained, 10 M+ downloads).

### 1.3 Support `meta.maxStaff` on FormSchema

- No Prisma schema change — `fields` is already a JSON column and `FormSchemaDefinition` supports arbitrary structure.
- Add `maxStaff?: number` to the form schema meta convention (documentation + seed).
- Validate at checkout: `additionalAttendees.length <= formSchema.meta.maxStaff`.

### 1.4 Add `?role` filter to public ticket-types endpoint

**File:** `Server/src/ticket-types/` (public controller)

```
GET /events/:eventId/ticket-types/public?role=visitor|exhibitor
```

| Param value | Filter |
|-------------|--------|
| `visitor` | `category !== 'exhibitor'` |
| `exhibitor` | `category === 'exhibitor'` |
| _(omitted)_ | Return all (backward compatible) |

### 1.5 Exhibitor checkout validation

**File:** `Server/src/payments/public-checkout.controller.ts`

When ticket `category === 'exhibitor'`:
- Enforce `quantity === 1`.
- If `additionalAttendees` provided: validate count ≤ `formSchema.meta.maxStaff`.
- `additionalAttendees` may be empty or absent — staff entry is optional.
- Staff attendees get `status: 'invited'` + registration tokens (existing logic handles this).

---

## Phase 2 — Dashboard: Exhibitor TicketKind

### 2.1 Add `'exhibitor'` to TicketKind

**File:** `Dashboard/src/app/dashboard/events/[id]/tickets/client.tsx`

```typescript
type TicketKind = 'regular' | 'membership' | 'exhibitor';
```

- Add 3rd radio/tab button in the ticket creation form.
- When `formKind === 'exhibitor'`:
  - Set `category = 'exhibitor'`.
  - Hide `membershipTier` selector.
  - Show form schema selector filtered to exhibitor-specific templates.

### 2.2 Update form template seed

**File:** `Server/src/form-templates/srd26-template-seeds.ts`

Changes to `template6_ExhibitorPackage()`:

| Field | Old | New |
|-------|-----|----|
| Return `category` | `'legal'` | `'exhibitor'` |
| `exhibitor_company_description` type | `'textarea'` | `'richtext'` |
| Schema meta | _(none)_ | `{ maxStaff: 5 }` |

Ensure a **staff section** exists in the template with:
- An informational help text: _"You may add up to {maxStaff} staff members now, or manage staff later from your Exhibitor Portal."_
- Fields are **not required** — the entire staff sub-step is optional.

---

## Phase 3 — Client: Role Choice Screen

### 3.1 Role state management

**File:** `sratix-client/public/js/sratix-embed.js`

- New `sessionStorage` key: `SRATIX_ROLE` = `'visitor'` | `'exhibitor'`
- Helpers: `setRole(role)`, `getRole()`, `clearRole()`

### 3.2 `renderRoleChoice()` screen

Two big buttons matching the `sratix-member-gate` visual style:

```
┌──────────────────────────────────────────────┐
│                                              │
│   How are you attending Swiss Robotics Day?  │
│                                              │
│   ┌──────────────────┐ ┌──────────────────┐  │
│   │   🎟️  Conference  │ │   🏢  Exhibitor   │  │
│   │     Visitor       │ │                  │  │
│   └──────────────────┘ └──────────────────┘  │
│                                              │
└──────────────────────────────────────────────┘
```

On click:
1. Store role in sessionStorage.
2. Proceed to member gate (if enabled) or directly to tickets.

Add `"← Change role"` link on subsequent screens for backtracking.

### 3.3 Modify `initTicketsWidget()` entry point

Updated flow:

```
initTicketsWidget()
  ├─ Stored role? ─── No ──→  renderRoleChoice()
  │                                    │
  │                              User picks role
  │                                    ↓
  ├─ Member session? ── No ──→  renderMemberGate()
  │                                    │
  │                           User authenticates (or skips)
  │                                    ↓
  └─ loadAndRenderTickets(role)  ←─────┘
         │
         └─ GET /ticket-types/public?role={visitor|exhibitor}
```

### 3.4 i18n keys

**File:** `sratix-client/public/js/sratix-i18n.js`

New keys _(all 5 locales: EN, DE, FR, IT, ZH-TW)_:

**Role choice screen:**
| Key | EN |
|-----|----|
| `roleChoice.title` | How are you attending Swiss Robotics Day? |
| `roleChoice.subtitle` | Select your role to see the right tickets for you. |
| `roleChoice.visitorLabel` | Conference Visitor |
| `roleChoice.visitorDesc` | Attend talks, demos, and networking sessions. |
| `roleChoice.exhibitorLabel` | Exhibitor |
| `roleChoice.exhibitorDesc` | Purchase a booth package and register your exhibition team. |
| `roleChoice.changeRole` | ← Change role |

**Exhibitor wizard:**
| Key | EN |
|-----|----|
| `exhibitorForm.companyTitle` | Company Information |
| `exhibitorForm.companySubtitle` | Basic details for your exhibitor listing. |
| `exhibitorForm.companyNote` | After purchasing your booth, you'll have access to the **Exhibitor Portal** to provide richer details, upload media, select your booth, and manage your team. |
| `exhibitorForm.staffTitle` | Booth Staff Passes |
| `exhibitorForm.staffSubtitle` | Your ticket includes up to {max} staff passes. |
| `exhibitorForm.staffOptionalNote` | You can add staff now or manage them later from your Exhibitor Portal. |
| `exhibitorForm.staffCount` | Number of staff to add now |
| `exhibitorForm.staffMax` | Maximum {max} staff included |
| `exhibitorForm.skipStaff` | Skip — I'll add staff later |

---

## Phase 4 — Client: Exhibitor Registration Wizard

### 4.1 `renderRichtextField()` — new field type handler

**File:** `sratix-embed.js` — inside `renderFormField()`

- New branch for `type: 'richtext'`.
- Vanilla JS `contentEditable` div with a basic toolbar:

  ```
  [ B ] [ I ] [ U ] [ 🔗 ] [ • ] [ 1. ]
  ┌──────────────────────────────────────┐
  │                                      │
  │  (editable area)                     │
  │                                      │
  └──────────────────────────────────────┘
  ```

- Toolbar buttons: **Bold**, **Italic**, **Underline**, **Link**, **Unordered List**, **Ordered List**.
- Port of Dashboard's `rich-text-editor.tsx` pattern to plain JS.
- Paste handler strips `font-family` styles from pasted HTML.
- `collectDynamicAnswers()` collects the `innerHTML` of the editable div.

### 4.2 `openExhibitorRegistrationWizard()`

Triggered when the user clicks "Select" on a ticket where `tt.category === 'exhibitor'`. Replaces the standard `openRegistrationModal()`.

#### Step indicator

Visual progress bar at top of wizard modal:

```
  ● Your Details ──── ○ Company Info ──── ○ Staff Passes
```

CSS-only, matching SRAtix design system. Current step highlighted; completed steps show ✓.

#### Sub-step 1 — Purchaser Details

Same fields as standard registration:

| Field | Type | Required |
|-------|------|----------|
| First Name | text | ✓ |
| Last Name | text | ✓ |
| Email | email | ✓ |
| Phone | phone | ✓ |
| Company / Organization | text | ✓ |

Pre-fill from WP user context if available.

Navigation: **Next →**

#### Sub-step 2 — Company Information

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Company Logo | image-upload | — | Max 2 MB, JPG/PNG/SVG |
| Company Description | richtext (WYSIWYG) | — | Rendered via `renderRichtextField()` |
| Company Website | url | — | |

Below the fields, an **informational note** (styled as a callout/info box):

> After purchasing your booth, you'll have access to the **Exhibitor Portal** where you can provide richer details, upload media, select your booth on the floor plan, and manage your exhibition team.

Navigation: **← Back** / **Next →**

#### Sub-step 3 — Staff Passes _(optional)_

Header text:

> Your ticket includes up to **{maxStaff}** staff passes. You can add staff now or manage them later from your Exhibitor Portal.

- **Number selector**: 0 to `maxStaff` (default: 0).
- When count > 0: dynamically spawn field blocks per staff member _(reuse styling from `openRecipientDetailsModal()`)_:

  | Field | Type | Required |
  |-------|------|----------|
  | First Name | text | ✓ (if block shown) |
  | Last Name | text | ✓ (if block shown) |
  | Email | email | ✓ (if block shown) |

- **"Skip — I'll add staff later"** link as a prominent shortcut that sets count to 0 and proceeds.
- Staff count = 0 is a perfectly valid submission.

Navigation: **← Back** / **Continue to Payment →**

### 4.3 Wire wizard to checkout

On submit, collect all data and POST to `/payments/checkout/public`:

```json
{
  "eventId": "...",
  "ticketTypeId": "...",
  "quantity": 1,
  "includeTicketForSelf": true,
  "firstName": "...",
  "lastName": "...",
  "email": "...",
  "phone": "...",
  "company": "...",
  "formData": {
    "exhibitor_logo": "...",
    "exhibitor_company_description": "<p>Rich <b>HTML</b> content</p>",
    "org_website": "https://..."
  },
  "additionalAttendees": [
    { "firstName": "Alice", "lastName": "Müller", "email": "alice@example.com" },
    { "firstName": "Bob", "lastName": "Meier", "email": "bob@example.com" }
  ]
}
```

- `additionalAttendees` is an **empty array** when no staff are entered (not omitted).
- Server handles staff as recipients: creates attendee records with `status: 'invited'`, generates registration tokens, sends gift emails.

---

## Phase 5 — Server: Checkout Flow Adjustments

### 5.1 Exhibitor checkout validation

**File:** `Server/src/payments/public-checkout.controller.ts`

In `PublicCheckoutController.checkout()`:

1. If ticket `category === 'exhibitor'`:
   - Enforce `quantity === 1` (BadRequestException if violated).
   - Load form schema meta → `maxStaff`.
   - Validate: `(additionalAttendees?.length ?? 0) <= maxStaff`.
2. Staff attendees (if any) → existing recipient creation loop handles:
   - Upsert attendee with `status: 'invited'`.
   - Generate registration token (64-char hex).
   - Set `purchasedByAttendeeId` to purchaser.
   - Store in `order.meta.recipientAttendees`.

### 5.2 Staff form schema assignment

When booth staff receive their registration tokens, their attendee records must be linked to the **Exhibitor Staff Pass** form (Template 7), not the Exhibitor Package form (Template 6).

**Approach:** Add `meta.staffFormSchemaId` to the exhibitor ticket type. At checkout, when creating staff attendees, store this form schema ID so that `GET /api/public/register/:token` returns the correct form for staff registration.

### 5.3 Exhibitor staff email customization

**File:** `Server/src/email/email.service.ts`

Detect exhibitor staff context when sending `sendTicketGiftNotification()`:
- **Subject:** "[Company Name] has registered you as booth staff for Swiss Robotics Day 2026"
- **Body:** Include exhibiting company name, event details, and staff-specific CTA: "Complete Your Booth Staff Profile".
- Staff recipients use **Template 7** (Exhibitor Staff Pass) for their registration form.

---

## Files Changed

| File | Change |
|------|--------|
| `Server/src/ticket-types/ticket-types.service.ts` | Add `'exhibitor'` to `TICKET_CATEGORIES` |
| `Server/src/ticket-types/` (public controller) | `?role` query param filter |
| `Server/src/forms/forms.service.ts` | `'richtext'` type validation + `sanitize-html` |
| `Server/src/payments/public-checkout.controller.ts` | Exhibitor validation (qty=1, optional staff ≤ maxStaff) |
| `Server/src/form-templates/srd26-template-seeds.ts` | Template 6 → category `'exhibitor'`, richtext, `meta.maxStaff` |
| `Server/src/email/email.service.ts` | Exhibitor staff email variant |
| `Server/package.json` | Add `sanitize-html` dependency |
| `Dashboard/src/app/dashboard/events/[id]/tickets/client.tsx` | 3rd TicketKind radio: `'exhibitor'` |
| `sratix-client/public/js/sratix-embed.js` | Role choice, exhibitor wizard, richtext field, step indicator |
| `sratix-client/public/js/sratix-i18n.js` | New keys (5 locales) |
| `sratix-client/public/css/sratix-embed.css` | Role choice + wizard + richtext + step indicator styles |

**No changes needed:**
- `Server/prisma/schema.prisma` — varchar fields already support new values.
- `sratix-control` webhook handler — exhibitor field mappings already exist (`exhibitor_vat_uid`, `exhibitor_billing_*`, etc.).

---

## Verification Checklist

- [ ] `TICKET_CATEGORIES` includes `'exhibitor'`; `getMeta()` returns it; `TicketCategory` type accepts it
- [ ] `validateSubmission()` accepts and sanitizes `'richtext'` field type; rejects `<script>`, allows `<b>`, `<a href>`
- [ ] Checkout rejects exhibitor ticket with `quantity > 1`
- [ ] Checkout accepts exhibitor ticket with `additionalAttendees = []` (no staff — deferred to portal)
- [ ] Checkout rejects exhibitor ticket with `additionalAttendees.length > meta.maxStaff`
- [ ] `?role=visitor` excludes exhibitor tickets; `?role=exhibitor` returns only exhibitor tickets; no param returns all
- [ ] Full exhibitor flow E2E:
  - Ticket page → Role Choice → Exhibitor → Member Gate → SRA login → Exhibitor tickets with discount → Select → Wizard Step 1 (purchaser) → Step 2 (company info with WYSIWYG + logo) → Step 3 (skip staff) → Stripe → Success
- [ ] Full exhibitor flow E2E **with staff**:
  - Same as above but Step 3: add 2 staff → Stripe → Staff receive gift emails → Staff complete registration via token (Template 7 form)
- [ ] Visitor flow unchanged:
  - Role Choice → Visitor → Member Gate → Regular/membership tickets (no exhibitor tickets) → standard flow
- [ ] Dashboard: create TicketKind = Exhibitor → saves `category='exhibitor'` → visible only in exhibitor flow
- [ ] Role switching: "← Change role" resets session correctly
- [ ] Existing multi-ticket recipient flow (non-exhibitor) works unchanged
- [ ] i18n: all new keys render correctly in DE, FR

---

## Architecture Notes

### Why reuse multi-recipient for staff?

The existing `additionalAttendees` pattern already solves the hard problems: attendee records, unique registration tokens, expiry management, gift emails, reminder cron jobs, and purchaser notifications. Staff passes are functionally identical to gifted tickets — someone buys, someone else registers.

The only difference is that exhibitor staff entry is **optional at checkout**. Staff not entered at checkout will be added later via the Exhibitor Portal, which will call the same server endpoints (attendee upsert + token generation) used by the checkout flow.

### Staff form schema assignment

Exhibitor ticket types carry `meta.staffFormSchemaId` pointing to Template 7 (Exhibitor Staff Pass). When a staff attendee clicks their registration link, `GET /api/public/register/:token` returns this form instead of the booth package form (Template 6).

### HTML sanitization

The `richtext` field type requires server-side sanitization. `sanitize-html` is the recommended package:
- Allowlist: `b`, `i`, `u`, `strong`, `em`, `a` (with `href` only), `ul`, `ol`, `li`, `p`, `br`
- Strip everything else (no `<script>`, `<style>`, `<img>`, event handlers)

### Image upload

The form engine already supports `image-upload` field type. The existing upload endpoint handles file validation (max size, MIME type). No changes anticipated for exhibitor context — verify CORS headers if widget runs cross-origin.

---

## Future: Exhibitor Portal

This plan lays the groundwork for the Exhibitor Portal by:

1. **Data model** — exhibitor company details stored as `FormSubmission` data at checkout, editable later.
2. **Staff model** — attendee records for staff are created the same way whether at checkout or via the portal.
3. **`meta.maxStaff`** — enforced at both checkout and portal (single source of truth for staff cap).
4. **Template separation** — Template 6 (booth package) vs Template 7 (staff pass) allows independent form evolution.

Portal features (managed separately):
- Edit company profile & media
- Add/remove/replace staff up to `maxStaff`
- Booth/floor-plan selection
- Lead capture dashboard
- Badge customization
