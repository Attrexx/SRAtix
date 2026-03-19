# Deployment Guide — Post-Test-Purchase Fixes

**Date:** 2026-03-19  
**Commits:** `f7bd12f` (Phase 2+3) → `621d04a` (Phase 1)  
**Scope:** Server, Dashboard, sratix-client WP plugin  

---

## Pre-Deployment Checklist

- [x] All 12 issues marked DONE in `POST-TEST-PURCHASE-ISSUES.md`
- [x] Server: `npx tsc --noEmit` passes
- [x] Dashboard: `npx tsc --noEmit` passes
- [x] Code pushed to `origin/main`
- [ ] **No Prisma schema changes** — no migration needed
- [ ] Create WordPress page for `[sratix_set_password]` shortcode (see Step 3)

---

## Step 1: Deploy Server + Dashboard (Infomaniak)

The SRAtix server is hosted on **Infomaniak shared Node.js hosting** with git-based deployment. Pushing to `main` triggers the remote to rebuild.

### On the Infomaniak hosting panel:

```bash
# SSH into the Node.js hosting, or use the one-click rebuild button

# If SSH access:
cd ~/site
git pull origin main

# Install dependencies + generate Prisma client
npm install

# Build Server (NestJS) + Dashboard (Next.js static export)
npm run build

# Restart the Node process
# (Infomaniak auto-restarts, or use the panel restart button)
```

### What `npm run build` does (root package.json):

```
cd Server && npm run build        →  NestJS compiles to Server/dist/
cd Dashboard && npm run build     →  Next.js exports to Dashboard/out/
```

The Server serves the Dashboard as a static SPA from `Dashboard/out/` via `@fastify/static`.

### Verify Server deployment:

```
# API health check
curl https://tix.swiss-robotics.org/api/health

# Dashboard loads
open https://tix.swiss-robotics.org/
```

---

## Step 2: Deploy sratix-client WP Plugin (swissroboticsday.ch)

The `sratix-client` plugin runs on the **event site** (`swissroboticsday.ch`). It's a standard WordPress plugin — copy the folder to `wp-content/plugins/`.

### Changed files:

| File | What changed |
|------|-------------|
| `includes/class-sratix-client-public.php` | New `[sratix_set_password]` shortcode, portal allows non-WP-users |
| `includes/class-sratix-client-admin.php` | Shortcode reference table updated |
| `public/js/sratix-embed.js` | Set-password widget, portal login form, boot sequence |
| `public/js/sratix-i18n.js` | New i18n keys for all 5 locales |
| `public/css/sratix-client.css` | Styles for login + password forms |

### Upload via FTP/SFTP or WP file manager:

```
# Upload the entire sratix-client/ folder to:
swissroboticsday.ch → wp-content/plugins/sratix-client/

# Or upload only the changed files:
sratix-client/includes/class-sratix-client-public.php
sratix-client/includes/class-sratix-client-admin.php
sratix-client/public/js/sratix-embed.js
sratix-client/public/js/sratix-i18n.js
sratix-client/public/css/sratix-client.css
```

### Clear caches after upload:

1. **WP Admin → WP Optimize** (or whichever cache plugin is active) → Purge All
2. **Cloudflare** (if active) → Development Mode ON, or purge cache
3. **Autoptimize** (if active) → Delete Cache

---

## Step 3: Create the "Set Password" WordPress Page

A new WordPress page is needed for the `[sratix_set_password]` shortcode. This page is where exhibitors land when they click the password setup link from their provisioning email.

### In WP Admin (swissroboticsday.ch):

1. **Pages → Add New**
2. **Title:** `Set Password` (or localised equivalent)
3. **Slug:** `set-password` ← must match the default `pagePaths.setPassword` value (`/set-password/`)
4. **Content:** Add a Shortcode block with:
   ```
   [sratix_set_password]
   ```
5. **Template:** Use the same template as other SRAtix pages (no sidebar, full-width)
6. **Publish**

### Verify the page:

```
open https://swissroboticsday.ch/set-password/?token=test123&setup=1
```

You should see a clean "Set Your Password" form (with an error on submit since `test123` is not a real token — that's expected).

---

## Step 4: Verify the Exhibitor Portal Page

The existing exhibitor portal page (`[sratix_exhibitor_portal]`) now supports two auth modes:

- **WordPress-logged-in users** → automatic WP identity exchange (unchanged behaviour)
- **Non-logged-in users** → email + password login form (new)

### Verify:

1. Visit the exhibitor portal page while **logged out** of WordPress
2. You should see an email + password login form (not a "please log in" message)
3. Entering valid exhibitor credentials should load the full portal

---

## Step 5: Test the Full Exhibitor Flow

### End-to-end verification (test mode):

1. **Purchase an exhibitor ticket** on swissroboticsday.ch
2. **Check admin notification email** — should show:
   - Ticket type names (not UUIDs) ✓
   - Ticket breakdown with quantities ✓
   - Exhibitor flag, company name, staff names ✓
3. **Check order confirmation email** — should include ticket codes ✓
4. **Check exhibitor provisioning email** — password setup link should point to:
   ```
   https://swissroboticsday.ch/set-password/?token=...&setup=1
   ```
   (NOT to `tix.swiss-robotics.org/auth/reset`)
5. **Click the password setup link** → "Set Your Password" form appears
6. **Set a password** → success message → redirects to `/exhibitor-portal/` after 3 seconds
7. **Portal loads** with email + password login → sign in → full exhibitor portal renders
8. **Dashboard** (`tix.swiss-robotics.org`):
   - Event overview: countdown shows "X days" (not "D-X"), revenue uses coins icon ✓
   - Exhibitors tab: staff count shows correct submitted count ✓
   - Tickets page: sold counters increment correctly ✓

### Staff invite flow:

1. In the portal, **invite a staff member** (add name + email)
2. Staff member receives email with password setup link → same `/set-password/` page
3. Staff member sets password → redirected to portal → can log in independently

---

## Rollback Plan

If something goes wrong:

### Server rollback:
```bash
# On Infomaniak hosting
cd ~/site
git revert 621d04a f7bd12f
git push
npm install && npm run build
# Restart process
```

### WP plugin rollback:
- Re-upload the previous version of `sratix-client/` from before the changes
- The `[sratix_set_password]` page can simply be unpublished

---

## Environment Notes

| Component | URL | Host |
|-----------|-----|------|
| SRAtix API + Dashboard | `tix.swiss-robotics.org` | Infomaniak Node.js |
| Event site (sratix-client) | `swissroboticsday.ch` | Infomaniak WP hosting |
| SRA main site (sratix-control) | `swiss-robotics.org` | Infomaniak WP hosting |
| Database | MariaDB 10.6 | `ks704.myd.infomaniak.com` |
| Cache | Upstash Redis | Cloud (TLS) |

**No database migration required** — all changes are in application code and `Event.meta` JSON fields.

**No sratix-control changes** — the control plugin on swiss-robotics.org is unchanged.
