# Plan: SRAtix Member-Type Gate & Tiered Pricing

Insert a **member-type selection step** before the ticket listing on swissroboticsday.ch. Three paths: **SRA members** (inline auth against swiss-robotics.org → per-tier dynamic pricing), **RobotX members** (shared access code → flat discount), and **non-members** (regular pricing). Full-stack changes across sratix-client, SRAtix Server, sratix-control, and Dashboard.

---

## Account Model

All ticket buyers — regardless of member type — get a **local SRD WordPress account** (on swissroboticsday.ch). This account is created during the purchase flow and gives every attendee access to:

- Downloading / requesting invoices
- Editing registration details on file
- Event-site sections visible only to ticket holders (future)

SRA WordPress accounts (on swiss-robotics.org) are created **only** when an attendee purchases a combined SRD+SRA ticket that includes an SRA membership product. This triggers the existing `order.paid` webhook flow from SRAtix Server → sratix-control, which calls `wp_insert_user()` on the SRA site, assigns a ProfileGrid group, and creates a WooCommerce membership order.

**SRA member authentication on SRD** is purely for **verifying existing SRA membership** in order to unlock tier-based discounts. It does not create or modify any account — it only reads the member's tier from swiss-robotics.org and returns it to the SRD purchase flow.

---

## Phase A — SRA Credential Verification (sratix-control on swiss-robotics.org) ✅ IMPLEMENTED

1. **New REST endpoint**: `POST /wp-json/sratix-control/v1/auth/sra-verify`
   - Accepts: `{ email, password }` + HMAC signature in `X-SRAtix-Signature` header (Server→WP direction, same pattern as webhooks)
   - Validates credentials via `wp_authenticate($email, $password)`
   - On success: resolves membership tier, returns `{ valid: true, wpUserId, email, firstName, lastName, membershipTier, roles[] }`
   - On failure: returns `{ valid: false, error: 'invalid_credentials' }` (no details leaked)
   - **Security**: Rate-limited via transient throttle, only accepts HMAC-signed requests from the SRAtix Server
   - File: `sratix-control/includes/class-sratix-control-webhook.php` (new route alongside existing webhook route)

2. **Tier resolution method** — `resolve_membership_tier( $user_id )`:
   - Check `sratix_membership_tier` user meta (fastest — set during original SRAtix ticket purchase)
   - Fallback: reverse-map ProfileGrid group ID → tier (Group 18 = academic, 17 = startup, etc.)
   - Fallback: check WP roles + WooCommerce active orders for membership products
   - Returns one of the 8 canonical tiers or `null`
   - File: `sratix-control/includes/class-sratix-control-webhook.php`

---

## Phase B — Server Auth Proxy & Discount Data Model ✅ IMPLEMENTED

### Auth Proxy

3. **SRA verify proxy**: `POST /api/auth/sra-verify` *(parallel with step 1)*
   - Accepts: `{ email, password, eventId }`
   - Server calls sratix-control endpoint (step 1) with HMAC-signed request
   - On success: issues short-lived session token encoding `{ memberGroup: 'sra', tier, eventId }`
   - Returns: `{ authenticated: true, firstName, membershipTier, sessionToken }`
   - On failure: generic error, no credential details
   - Files: `Server/src/auth/auth.controller.ts`, `Server/src/auth/auth.service.ts`

4. **RobotX code verify**: `POST /api/events/:eventId/robotx/verify`
   - Accepts: `{ code }`
   - Validates against `Event.meta.robotxAccessCode`
   - On success: issues session token encoding `{ memberGroup: 'robotx', eventId }`
   - Returns: `{ valid: true, sessionToken }`
   - On failure: `{ valid: false }`
   - File: `Server/src/events/events.controller.ts` (or new lightweight controller)

### Schema Changes

5. **New Prisma model** — `TicketTypeSraDiscount`:
   ```
   id              String  @id @default(uuid())
   ticketTypeId    String  (FK → TicketType)
   membershipTier  String  (student | individual | retired | industry_small | industry_medium | industry_large | academic | startup)
   discountType    String  (percentage | fixed_amount)
   discountValue   Int     (1–100 for %, or cents for fixed)
   @@unique([ticketTypeId, membershipTier])
   ```
   File: `Server/prisma/schema.prisma`

6. **TicketType schema extension** — add fields for flat RobotX discount:
   ```
   robotxDiscountType   String?   (percentage | fixed_amount)
   robotxDiscountValue  Int?
   ```
   File: `Server/prisma/schema.prisma`

7. **Event.meta extension** — add `robotxAccessCode` string for code verification.
   - Use the existing `Event.meta` JSON field to avoid a migration for a single column.
   - File: `Server/prisma/schema.prisma` (no schema change needed — JSON field)

8. **Prisma migration** — `npx prisma migrate dev --name add-member-discounts` *(depends on 5–7)* ⚠️ **NOT YET RUN — run before first deployment**

### Discount CRUD

9. **Ticket-types service** — extend `TicketTypesService` *(depends on 8)*:
   - `setSraDiscounts(ticketTypeId, discounts: { tier, type, value }[])` — batch upsert
   - `getSraDiscounts(ticketTypeId)` — list all
   - `setRobotxDiscount(ticketTypeId, type, value)` — update TicketType fields
   - File: `Server/src/ticket-types/ticket-types.service.ts`

10. **Discount endpoints** — new routes on `TicketTypesController`:
    - `PUT  /events/:eventId/ticket-types/:id/sra-discounts` — batch upsert `[{ tier, discountType, discountValue }]`
    - `GET  /events/:eventId/ticket-types/:id/sra-discounts` — list
    - RobotX discount handled via existing `PATCH /events/:eventId/ticket-types/:id` (new fields)
    - File: `Server/src/ticket-types/ticket-types.controller.ts`

### Public Pricing

11. **Public ticket endpoint extension** — `GET .../ticket-types/public`:
    - Add optional query param: `?memberGroup=sra&memberTier=student` or `?memberGroup=robotx`
    - When present, include `discountedPriceCents` in response alongside `priceCents`
    - Also include `sraDiscounts[]` and `robotxDiscount` per ticket type for client-side "You save X%" display
    - **Requires valid `Authorization: Bearer {sessionToken}` header** (from step 3 or 4) — no token = regular prices only, no discounted prices leaked
    - File: `Server/src/ticket-types/ticket-types-public.controller.ts`

---

## Phase C — Dashboard Admin UI ✅ IMPLEMENTED

12. **Ticket type form: SRA Discounts section** — new collapsible section:
    - Toggle: "Enable SRA Member Discounts"
    - When enabled: grid of 8 tiers, each row with:
      - Tier label (read-only)
      - Discount type dropdown (`percentage` / `fixed_amount`)
      - Discount value input (number)
    - Quick-fill: "Apply same discount to all individual tiers" / "all legal tiers"
    - File: Dashboard ticket-type form (`tickets/client.tsx`)

13. **Ticket type form: RobotX Discount section** — simpler:
    - Toggle: "Enable RobotX Member Discount"
    - Discount type dropdown + value input
    - File: same as step 12

14. **Event settings: RobotX Access Code** — new field:
    - Label: "RobotX Access Code"
    - Text input with **Copy** + **Generate Random** buttons
    - File: Dashboard event-settings page

---

## Phase D — Client UI: Member Gate & Pricing (sratix-client) ✅ IMPLEMENTED

15. **Member gate screen** — new UI state in `sratix-embed.js` before ticket listing:
    - Renders when `sratixConfig.memberGateEnabled` is `true` (new admin option)
    - Three large card-style buttons:
      ```
      "I am a member of:"
      [ Swiss Robotics Association ]   [ ETH RobotX ]
              [ I am not a member (regular tickets) ]
      ```
    - Logos loaded from plugin `public/images/` directory or admin-configured URLs
    - "Not a member" proceeds directly to ticket listing with regular prices
    - Selection stored in `sessionStorage` key `sratix_member_type` (persists across same-tab reloads)
    - File: `sratix-client/public/js/sratix-embed.js`

16. **SRA inline login form** — shown after clicking the SRA button:
    - Two fields: Email, Password
    - Heading: "Sign in with your swiss-robotics.org account"
    - Submit → `POST {apiUrl}/auth/sra-verify { email, password, eventId }`
    - On success: store `{ memberGroup: 'sra', tier, firstName, sessionToken }` in `sessionStorage`; proceed to ticket listing with discounted prices
    - On failure: inline error "Invalid credentials. Please use your swiss-robotics.org login."
    - "← Back" link to return to member gate
    - File: `sratix-client/public/js/sratix-embed.js`

17. **RobotX code entry form** — shown after clicking the RobotX button:
    - One field: "Enter your RobotX access code"
    - Submit → `POST {apiUrl}/events/{eventId}/robotx/verify { code }`
    - On success: store `{ memberGroup: 'robotx', sessionToken }` in `sessionStorage`; proceed to ticket listing
    - On failure: "Invalid code. Please contact RobotX for your access code."
    - "← Back" link
    - File: `sratix-client/public/js/sratix-embed.js`

18. **Dynamic price display** — modify ticket card rendering:
    - If `memberGroup` is set, fetch tickets with `?memberGroup=...&memberTier=...` and include `Authorization: Bearer {sessionToken}`
    - Display: ~~CHF 150~~ **CHF 120** (red, prominent) + savings badge "SRA Member: -20%"
    - Non-members: regular price only, no decoration
    - File: `sratix-client/public/js/sratix-embed.js`

19. **Checkout payload** — pass member context to the checkout API:
    - Include `memberGroup`, `memberTier`, `sessionToken` in the checkout POST payload
    - Server validates session token and applies the correct discount server-side (source of truth) — prevents client-side price manipulation
    - File: `sratix-client/public/js/sratix-embed.js` + `Server/src/payments/` (public checkout)

20. **CSS** — new styles in `sratix-client.css`:
    - `.sratix-member-gate` — centered flex/grid layout for the 3 buttons
    - `.sratix-member-btn` — large card button (navy bg, border, hover effect, logo + text)
    - `.sratix-member-btn--sra` / `--robotx` / `--regular` — color accents per type
    - `.sratix-login-form` — compact inline form within the member gate area
    - `.sratix-price-original` — `text-decoration: line-through; color: var(--sratix-text-muted)`
    - `.sratix-price-member` — `color: var(--sratix-red); font-weight: bold; font-size: 1.2em`
    - `.sratix-savings-badge` — small pill showing discount percentage
    - File: `sratix-client/public/css/sratix-client.css`

21. **Admin setting: enable member gate** — new fields in sratix-client admin:
    - "Enable Member Type Selection" checkbox
    - Logo URLs for SRA and RobotX (or use defaults from plugin assets)
    - File: `sratix-client/includes/class-sratix-client-admin.php`

---

## Phase E — Checkout Validation (Server) ✅ IMPLEMENTED

22. **Server-side discount enforcement** — extend public checkout handler:
    - If `memberGroup` + `sessionToken` provided in checkout payload:
      - Validate session token (check expiry, match event)
      - Resolve applicable discount for the ticket type + tier/group
      - Apply discount to `unitPriceCents` before Stripe session creation
    - If no member context: regular price
    - If invalid/expired session token: reject with `401`, prompt re-authentication
    - Order metadata records: `memberGroup`, `memberTier` (for reporting & audit)
    - File: `Server/src/payments/` (public checkout service)

23. **Stripe line item display** — include discount info in Stripe checkout:
    - Product name: "SRD 2026 — Full Day (SRA Academic -20%)" or "SRD 2026 — Full Day (RobotX Member)"
    - Alternatively use Stripe coupons/discounts for transparent line-item display
    - File: `Server/src/payments/stripe.service.ts`

---

## Relevant Files

| File | Change |
|------|--------|
| `sratix-control/includes/class-sratix-control-webhook.php` | Add `sra-verify` REST route + `resolve_membership_tier()` |
| `Server/src/auth/auth.controller.ts` + `auth.service.ts` | SRA verify proxy endpoint |
| `Server/prisma/schema.prisma` | `TicketTypeSraDiscount` model, RobotX fields on `TicketType` |
| `Server/src/ticket-types/ticket-types.service.ts` + `controller` | Discount CRUD, public pricing with member discounts |
| `Server/src/payments/` | Checkout validation with member pricing enforcement |
| Dashboard ticket form (`tickets/client.tsx`) | SRA/RobotX discount config sections |
| Dashboard event settings | RobotX Access Code field |
| `sratix-client/public/js/sratix-embed.js` | Member gate UI, login/code forms, dynamic pricing |
| `sratix-client/public/css/sratix-client.css` | Gate layout, pricing styles, savings badge |
| `sratix-client/includes/class-sratix-client-admin.php` | Member gate enable toggle, logo URLs |
| `sratix-client/includes/class-sratix-client-public.php` | Pass `memberGateEnabled` + logo URLs to JS config |

---

## Verification

1. **Unit tests**: `resolve_membership_tier()` mock scenarios — user with meta, user with ProfileGrid group only, user with WC order only, user with nothing
2. **Unit tests**: Discount calculation per tier (percentage + fixed), RobotX flat discount
3. **Integration tests**: SRA login → session token → discounted prices returned; RobotX code → session token → discounted prices returned
4. **Manual**: Gate UI → SRA login → strikethrough prices → checkout → Stripe receives discounted amount
5. **Manual**: Gate UI → RobotX code → flat discount visible → checkout validates
6. **Manual**: "Not a member" → regular prices, no discount UI
7. **Security**: No session token → public endpoint returns regular prices only (no discount leak)
8. **Security**: Manipulated checkout payload → server recalculates from discount rules, ignores client-supplied price

---

## Decisions

- **Inline SRA auth** (no redirect to swiss-robotics.org), proxied through SRAtix Server to avoid CORS and keep HMAC secrets server-side
- **All attendees get SRD accounts** — local WP user on swissroboticsday.ch for ticket management; SRA account creation only for tickets that include an SRA membership product
- **Per-tier SRA discounts** in dedicated join table (`TicketTypeSraDiscount`); **flat RobotX discount** directly on `TicketType`
- **RobotX access code** stored at Event level (one code per event, in `Event.meta`)
- **Server is pricing source of truth** — client displays prices but server re-validates and enforces at checkout
- **`sessionStorage`** for member selection persistence (tab-scoped, survives refreshes, clears on tab close)

---

## Excluded (Future Scope)

- **SRA member My Tickets on SRD** — SRA-authenticated users managing tickets on swissroboticsday.ch via their SRA identity. Requires account-bridging or shadow-user decisions. Deferred.
- **ETH RobotX custom authentication** — explicitly out of scope; code-verification only for now.
- **Promo code + member discount stacking** — TBD (see below).

---

## Additional Details

1. **Promo + member discount: whichever is higher wins** — If an SRA/RobotX member also enters a promo code, the system applies **whichever discount is greater** (not both). Server compares `memberDiscountCents` vs `promoDiscountCents` and applies the larger one. The checkout summary and Stripe line item should indicate which discount was applied (e.g. "SRA Academic discount applied" or "Promo code EARLYBIRD applied — better than member discount").
2. **Session TTL: 2 hours** — SRA/RobotX verified sessions expire after 2 hours. Configurable in Server settings. On expiry, the client prompts re-authentication before checkout can proceed.
3. **Personalized welcome message** — After successful SRA authentication, display a welcome banner: *"Welcome back, Dr. Müller! Your Academic membership gives you 20% off."* Uses the `firstName` and `membershipTier` from the verify response. Builds trust and confirms the correct tier is applied.