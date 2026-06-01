# Exhibitor Onboarding — Bug Fixes & Provisioning Unification

> **Date:** 2026-06-01
> **Author:** TAROS Web Services
> **Status:** ✅ Implemented

Fixes three reported onboarding bugs and answers the "where are the WP exhibitor users?" question.

---

## Account model (answer to "aren't we supposed to create WP users?")

**Exhibitors are SRAtix-native users — not WordPress users. This is by design.**

- `provisionExhibitorForOrder` / `provisionStaffAccess` create a SRAtix `User` + `UserRole(role='exhibitor')` (scoped to an exhibitor `Organization`) in the SRAtix DB. The Exhibitor Portal authenticates **directly against the SRAtix API** (`POST /api/auth/login`) — see `sratix-embed.js → renderPortalLoginForm`. No WordPress account is involved.
- `sratix-control` adds the **WordPress** `exhibitor` role only to membership/ticket **buyers** via the `order.paid` webhook — purely for admin tagging/filtering in WP. It is unrelated to portal access.
- The single stale WP `exhibitor`-role user (`test@rat.com`) is leftover early-test data. The 8 SRAtix exhibitors correctly have **no** WP users.
- **Optional cleanup (no code):** remove the `exhibitor` role from `test@rat.com` via WP Admin → Users.

---

## Bugs fixed

### 1. Booth-staff registration dead-end
Staff opening their registration link were shown the **exhibitor company form** (legal name / VAT / billing / consents) which has no name field, then blocked on *"First name and last name are required."*

- **Server** (`attendees/public-registration.controller.ts`): detect staff passes (ticket `meta.staffPass` or an `ExhibitorStaff` row linked to the attendee). For staff, **suppress the company form schema** (no fallback) and return `isStaffPass` + `companyName`.
- **Client** (`sratix-embed.js → initAttendeeRegisterWidget`): for staff, render the simple default form (name / phone / read-only email + read-only booth company) with a "booth staff" note (`reg.staffNote`, 5 languages). Added a defensive fallback so a custom form lacking name fields can never dead-end (falls back to the invited attendee's name).

### 2 & 3. No portal-setup email / lands on login instead of set-password
- **Free/comp exhibitor orders never provisioned** (`public-checkout.controller.ts` free path): no account, no confirmation, no welcome email; staff got the buggy attendee-register gift email. Now unified — free/comp exhibitor orders run the same `provisionExhibitorForOrder` + order confirmation as paid orders.
- **Reused email with an existing password** got a welcome email **without** a set-password link. Now the welcome email **always** carries an actionable link: `?setup=1` (new account → "Set Password") or a reset link (existing account → "Reset Your Password"), with `accountExists` wording.
- **Paid path:** exhibitor staff no longer receive the attendee-register gift email (the loop is guarded with `!isExhibitorOrder`); they get the portal/set-password invite only.

---

## Code map

| Area | File | Change |
|------|------|--------|
| Shared provisioning | `Server/src/exhibitor-portal/exhibitor-portal.service.ts` | New `provisionExhibitorForOrder(orderId)` + `provisionExhibitorAccount(...)` (moved from webhook); always issues a set/reset token; `accountExists`. |
| Welcome email | `Server/src/email/email.service.ts` | `sendExhibitorWelcome` always shows the password section; setup-vs-reset copy via `accountExists`. |
| Paid path | `Server/src/payments/stripe-webhook.controller.ts` | Calls shared service; removed the inline `provisionExhibitor`; guards gift emails with `!isExhibitorOrder`. |
| Free path | `Server/src/payments/public-checkout.controller.ts` | Exhibitor free/comp orders: confirmation + shared provisioning; visitor gift path unchanged. |
| Staff detection | `Server/src/attendees/public-registration.controller.ts` | `isStaffPass` + `companyName`; suppress company schema for staff. |
| Staff form | `sratix-client/public/js/sratix-embed.js`, `public/js/sratix-i18n.js` | Simple staff form + name fallback + `reg.staffNote`. |

## Deployment
- **No Prisma migration** (no schema changes) and **no module reinstall** (no new deps).
- Server: `npm run build` + restart. WordPress: FTP `sratix-client/public/js/sratix-embed.js` + `sratix-i18n.js`.
