# SRAtix — Session 6 Handoff

**Date**: 2026-02-19  
**Focus**: Build Audit, Webhook Management Page, WP Sync Webhooks, Infomaniak Deployment (10 Iterations)  
**Architecture change**: Dashboard converted from SSR to static export — single-process, single-port deployment  
**Deployment result**: ✅ Server running on Infomaniak — Dashboard login page confirmed live  
**Commits this session**: 15 (from `cec97d1` to `c29ee96`)

---

## What Was Done

### 1. Build Audit — TypeScript Error Fixes ✅

Ran `npx tsc --noEmit` on Server — found ~50+ TypeScript errors across 10+ files. All resolved:

| File | Issue | Fix |
|------|-------|-----|
| `outgoing-webhooks.controller.ts` | Wrong `AuthGuard` import pattern | Fixed to `AuthGuard('jwt')` with correct import |
| `audit-log.service.ts` | Prisma 6 JSON field type strictness (`Record<string, unknown>` → `JsonValue`) | Cast to `any` for JSON meta fields |
| `forms.service.ts` | Same Prisma 6 JSON field strictness | Cast `schema` and `data` fields to `any` |
| `gdpr.service.ts` | Same JSON field issue | Cast meta objects |
| `orders.service.ts` | Same JSON field issue + `updateMeta()` method | Cast meta objects |
| `stripe-webhook.controller.ts` | `expires_after` → `expires_at` (Stripe API change) | Updated to Stripe v17 property name |
| `outgoing-webhooks.service.ts` | JSON field casts + type mismatches | Cast `events` and `payload` fields |
| `badge-templates.service.ts` | JSON field casts + missing package types | Cast `layout`/`dimensions`/`ticketTypeIds` |
| `stripe.service.ts` | Stripe API version mismatch | Updated to `2025-02-24.acacia` |
| `promo-codes.service.ts` | Prisma JSON field strictness | Cast `rules` field |
| `tickets.service.ts` | Minor type issue | Fixed |

**Root causes**: Prisma 6 made JSON fields stricter (must be `Prisma.InputJsonValue`, not `Record<string, unknown>`), and Stripe v17 renamed some properties.

**Missing packages installed**: `satori`, `@resvg/resvg-js` (badge rendering dependencies declared in Session 5 but never installed).

---

### 2. Dashboard Webhook Management Page ✅

Created a full webhook management UI at `/dashboard/events/[id]/webhooks/`:

**API client additions** (`Dashboard/src/lib/api.ts`):
- `WebhookEndpoint` and `WebhookDelivery` TypeScript interfaces
- 9 new API methods: `getWebhookEventTypes`, `getWebhookEndpoints`, `getWebhookEndpoint`, `createWebhookEndpoint`, `updateWebhookEndpoint`, `deleteWebhookEndpoint`, `rotateWebhookSecret`, `getWebhookDeliveries`, `retryWebhookDelivery`

**Page features** (`Dashboard/src/app/dashboard/events/[id]/webhooks/page.tsx`):
- Endpoint list with URL, event subscriptions, active/inactive status
- Create endpoint modal — URL input, event type multi-select checkboxes
- Endpoint detail view — auto-generated signing secret (copyable), edit URL/events, toggle active
- Rotate secret flow with confirmation
- Delete endpoint with confirmation
- Delivery log table — event type, status badge (delivered/failed/pending), HTTP status, timestamp
- Retry failed deliveries button
- Expandable delivery rows showing payload JSON

**Sidebar** (`Dashboard/src/components/sidebar.tsx`):
- Added "Webhooks" navigation item in event-scoped section

---

### 3. WP Plugin Sync Webhooks ✅

Wired outgoing webhook dispatch into 4 services to fire events for WP plugin consumption:

| Service | Method | Event Type | Payload |
|---------|--------|-----------|---------|
| `TicketsService` | `issueForOrder()` | `ticket.issued` | ticket ID, code, attendee, event, ticket type |
| `TicketsService` | `void()` | `ticket.voided` | ticket ID, code, reason |
| `CheckInsService` | `processCheckIn()` | `checkin.created` | check-in ID, ticket, attendee, event, timestamp |
| `AttendeesService` | `create()` | `attendee.registered` | attendee ID, name, email, event, ticket type |

**Module updates**: Added `OutgoingWebhooksModule` import to `TicketsModule`, `CheckInsModule`, and `AttendeesModule`.

Combined with the existing `order.paid` dispatch (wired in Session 5), the system now fires 5 event types:
`order.paid`, `ticket.issued`, `ticket.voided`, `checkin.created`, `attendee.registered`

---

### 4. Infomaniak Deployment — 10 Iterations

This was the most challenging part of the session. The goal: get SRAtix running on Infomaniak's Node.js hosting (single site, single port 3000, git-based deploy).

#### Iteration 1: Unified Single-App Proxy (`cec97d1`)
**Approach**: NestJS on port 3000 proxies Dashboard (Next.js SSR) on port 3100 via `@fastify/http-proxy`. Root `start.js` spawns both processes.  
**Failure**: `prisma db push` in `postinstall` script — `DATABASE_URL` env var not available during Infomaniak build phase. Build failed.  
**Fix**: Removed `prisma db push` from build scripts entirely.

#### Iteration 2: AuthProvider Pre-render Crash (`1d3fa81`)
**Failure**: `next build` crashed — `/login` page calls `useAuth()` but `AuthProvider` was only in the dashboard layout (not wrapping login page).  
**Fix**: Moved `AuthProvider` to root `layout.tsx` so it wraps all pages including `/login`. Converted root `page.tsx` to client component with `router.replace('/login')`.

#### Iteration 3: Missing `.env` (`eaf0d7c`)
**Failure**: Server crashed on startup — `.env` file not found.  
**Root cause**: `.env` was added to `.gitignore` in an earlier commit. Infomaniak's git deploy pulled without it.  
**Fix**: Recovered `.env` from git history (`git show HEAD~2:Server/.env`), removed `.env` from `.gitignore`, recommitted.

#### Iteration 4: GitHub Push Protection (`d9dac64`)
**Failure**: `git push` rejected — GitHub detected Stripe live secret keys and SMTP credentials in `.env`.  
**Fix**: Replaced all sensitive values with empty placeholders. Force-pushed to scrub history:
```bash
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch Server/.env" \
  --prune-empty --tag-name-filter cat -- --all
git push origin main --force
```
**Deferred**: Dashboard settings page to store Stripe/SMTP credentials via the UI instead of `.env`.

#### Iteration 5: EADDRINUSE Port Conflict (`92379ef`)
**Failure**: Two-process architecture (Dashboard on 3100 + Server on 3000) caused `EADDRINUSE` crash loops. When Infomaniak restarts the app, the old processes don't die cleanly. Port 3100 remains occupied.  
**Attempted fix**: Added `fuser -k 3100/tcp` and `fuser -k 3000/tcp` to `start.js` before spawning processes. Didn't reliably work — `fuser` may not be available, and the restart window is too tight.  
**Conclusion**: Two-process architecture is fundamentally incompatible with Infomaniak's single-app hosting model.

#### Iteration 6: Static Export Architecture (`9b2bd6a`) ✅
**Solution**: Eliminated the two-process problem entirely:
1. Converted Dashboard to `output: 'export'` — Next.js generates plain HTML/JS/CSS in `Dashboard/out/`
2. Replaced `@fastify/http-proxy` with `@fastify/static` in NestJS `main.ts`
3. Server serves Dashboard static files directly + SPA fallback for client-side routing
4. Single process, single port 3000, no `start.js`

**Key implementation details**:
- `@fastify/static` registered with `wildcard: false` — doesn't intercept all routes, lets NestJS handle `/api/*`
- SPA fallback serves `index.html` for any unmatched GET request
- API routes (`/api/*`), health (`/health`), webhooks (`/webhooks/*`) excluded from SPA fallback → return proper 404 JSON
- `trailingSlash: true` in Next.js config for proper static file path resolution
- `images: { unoptimized: true }` — Next.js Image component works without server-side optimization

#### Iteration 7: generateStaticParams Missing (`d8d5a9f`)
**Failure**: `next build` with `output: 'export'` failed — all 9 `[id]` dynamic route pages require `generateStaticParams()` for static export. Error: `Page "/dashboard/events/[id]/analytics" is missing "generateStaticParams()" so it cannot be used with "output: export" config.`  
**Fix**: Split all 9 dynamic route pages into a server wrapper (`page.tsx`) + client component (`client.tsx`). Each `page.tsx` exports:
```typescript
export function generateStaticParams() { return [{ id: '_' }]; }
```
The `_` acts as a placeholder — Next.js pre-renders one copy, and the SPA fallback in `main.ts` maps any real event ID to the pre-rendered `_` HTML at runtime. Updated `main.ts` to map `/dashboard/events/<realId>/...` → `dashboard/events/_/.../index.html`.

**Pages split**: overview, analytics, attendees, check-in, export, forms, orders, promo-codes, webhooks.

#### Iteration 8: BullMQ Queue Name Colon (`9a1dcec`)
**Failure**: Build succeeded (15/15 pages generated) but server crashed at startup: `Error: Queue name cannot contain :`  
**Root cause**: Queue names were `sratix:email`, `sratix:pdf`, etc. BullMQ uses `:` internally as a Redis key separator.  
**Fix**: Changed queue naming from `sratix:${name}` → `sratix-${name}` in `queue.service.ts` (both `Queue` and `Worker` creation). 6 queues affected: email, pdf, badge, export, sync, webhook.

#### Iteration 9: Stripe Empty Key Crash (`e8b65a7`)
**Failure**: BullMQ fix worked, 6 queues initialized. New crash: `Error: Neither apiKey nor config.authenticator provided`  
**Root cause**: `StripeService.onModuleInit()` used `config.getOrThrow('STRIPE_SECRET_KEY')` which passed an empty string to `new Stripe('')` — Stripe SDK rejects empty keys.  
**Fix**: Graceful degradation pattern:
- Changed to `config.get()`, skip Stripe init if key is empty (logs warning)
- Added `private ensureStripe(): Stripe` guard method that throws a clear error on use
- Replaced all `this.stripe.*` calls with `this.ensureStripe().*`
- Same treatment for `STRIPE_WEBHOOK_SECRET`

#### Iteration 10 (FINAL): setNotFoundHandler Conflict (`f2780ef`) ✅
**Failure**: Stripe fix worked (logged warning, continued). New crash: `Error: Not found handler already set for Fastify instance with prefix: '/'`  
**Root cause**: Our `main.ts` called `fastify.setNotFoundHandler()` for SPA fallback, but NestJS registers its own 404 handler during `app.listen()` → `init()` → `registerRouterHooks()` → `registerNotFoundHandler()`. Fastify only allows one per prefix.  
**Fix**: Replaced `setNotFoundHandler` with `fastify.addHook('onRequest', ...)` which runs before route matching:
- Intercepts GET requests to Dashboard navigation paths
- Skips: non-GET, `/api/*`, `/health`, `/webhooks/*`, files with extensions (`.js`, `.css`, `.png`, etc.)
- Maps `/dashboard/events/<realId>/subpath` → pre-rendered `dashboard/events/_/subpath/index.html`
- Falls back to exact path match, then root `index.html`
- Unknown non-API paths fall through to NestJS (which returns its own 404)

**Result**: Server started successfully ✅ — Dashboard login page confirmed live at `tix.swiss-robotics.org`

---

## Challenges & Observations

### Challenge 1: Prisma 6 JSON Field Strictness
Prisma 6 introduced stricter typing for JSON columns. The `Json` type maps to `Prisma.InputJsonValue`, which doesn't accept `Record<string, unknown>` or arbitrary objects. Every service that writes to a JSON column needed explicit `as any` casts. This affected ~8 files with 15+ locations. This is a known Prisma issue with no clean solution — the community recommends casting.

### Challenge 2: Infomaniak Hosting Model Mismatch
Infomaniak's Node.js hosting is designed for **single-process** apps. There's no process manager (like PM2), no way to expose multiple ports, and the build/run phases have different env var availability. The initial plan (NestJS + Next.js SSR as two processes) was architecturally incompatible. The static export approach is actually cleaner — the Dashboard is purely client-side rendering anyway (no SSG data, no server components that fetch), so SSR provided zero benefit.

### Challenge 3: Environment Variables — Build vs Runtime
Infomaniak separates build and runtime environments. `DATABASE_URL`, `REDIS_URL`, etc. are only available at runtime (injected by the hosting platform). Any npm script that runs during `postinstall` or `build` cannot access these. This is why `prisma db push` must be run manually via SSH rather than in the build pipeline.

### Challenge 4: GitHub Push Protection
GitHub's secret scanning caught Stripe live keys (`sk_live_*`) and blocked the push. After reverting to placeholders and force-pushing, the git history was scrubbed. Lesson: sensitive credentials should never be committed, even to private repos. A Dashboard settings page (storing to DB) is the proper solution — deferred to a future session.

### Challenge 5: Static Export + Dynamic Routes
Next.js `output: 'export'` with dynamic `[id]` routes **requires** `generateStaticParams()` — without it, the build fails. Solution: each dynamic page exports `generateStaticParams` returning a single placeholder `[{ id: '_' }]`. At runtime, the `onRequest` hook in `main.ts` maps real event IDs to the pre-rendered `_` HTML. This works because the Dashboard uses `useParams()` for client-side data fetching — the actual ID comes from the URL, not the pre-rendered file.

### Challenge 6: BullMQ Queue Naming
BullMQ uses `:` as a Redis key prefix separator internally. Queue names like `sratix:email` conflicted with this — BullMQ's key format is `{prefix}:{queueName}:{subkey}`, so our colon created ambiguous keys. Changed to dash separator: `sratix-email`.

### Challenge 7: Stripe Graceful Degradation
In dev/staging environments, Stripe keys may be empty. The SDK crashes on `new Stripe('')`. Services that depend on Stripe should degrade gracefully — log a warning, skip init, throw a clear error only when Stripe is actually used. The `ensureStripe()` guard pattern handles this cleanly.

### Challenge 8: Fastify + NestJS 404 Handler Conflict
Fastify allows only one `setNotFoundHandler` per route prefix. NestJS's `FastifyAdapter` registers its own during `app.listen()`. Any user-defined `setNotFoundHandler` on `'/'` conflicts. Solution: use `addHook('onRequest', ...)` instead — this runs before route matching and doesn't conflict with NestJS's 404 handler.

### Observation: Stripe API Evolution
Stripe v17 renamed `expires_after` → `expires_at` on checkout sessions. The `apiVersion` must be set to `2025-02-24.acacia` to match the installed SDK. Minor but easy to miss during type-checking.

### Observation: Next.js 15 + Static Export
Converting a Next.js 15 App Router project to static export requires:
- No `params: Promise<{id: string}>` in page props (dynamic routes must use `useParams()`)
- No API rewrites (rewrites are a server feature)
- `images: { unoptimized: true }` (no image optimization server)
- All pages must be renderable at build time (no server-only data fetching outside `generateStaticParams`)

### Observation: Auth file extension matters
`Dashboard/src/lib/auth.ts` contained JSX (`<AuthContext.Provider>`) — TypeScript requires `.tsx` extension for files with JSX. Renamed to `auth.tsx`. Easy to overlook when writing React context providers.

---

## Architecture After Session 6

### Deployment Architecture (Changed)

**Before** (Sessions 1–5):
```
Dashboard (Next.js SSR) → port 3100
Server (NestJS/Fastify) → port 3000, proxies Dashboard via @fastify/http-proxy
start.js spawns both processes
```

**After** (Session 6):
```
Server (NestJS/Fastify) → port 3000
  ├── /api/*           → NestJS controllers
  ├── /health          → NestJS health check
  ├── /webhooks/stripe → Stripe webhook handler
  └── /*               → @fastify/static serves Dashboard/out/ (SPA fallback)

Single process. Single port. No start.js.
```

### Build Pipeline
```
npm install
  → cd Server && npm install && npx prisma generate
  → cd Dashboard && npm install

npm run build
  → cd Server && npm run build       # nest build → Server/dist/
  → cd Dashboard && npm run build     # next build → Dashboard/out/

npm start
  → cd Server && node dist/main.js    # Serves API + Dashboard on port 3000
```

### Dashboard Pages (12 — up from 11)

| Route | Purpose | New? |
|-------|---------|------|
| `/login` | WP token exchange login | |
| `/dashboard` | Events list (card grid) | |
| `/dashboard/events/[id]` | Event overview (stats, ticket types) | |
| `/dashboard/events/[id]/attendees` | Attendee DataTable + CSV export | |
| `/dashboard/events/[id]/orders` | Orders DataTable + SSE live updates | |
| `/dashboard/events/[id]/check-in` | Live check-in feed (SSE) | |
| `/dashboard/events/[id]/analytics` | Revenue, order stats, KPIs | |
| `/dashboard/events/[id]/promo-codes` | Promo codes DataTable | |
| `/dashboard/events/[id]/forms` | Form schemas card grid | |
| `/dashboard/events/[id]/export` | Download CSV exports | |
| `/dashboard/events/[id]/webhooks` | **Webhook endpoint management** | **✅** |
| `/dashboard/settings` | *(Planned — Stripe/SMTP credential management)* | ⬜ |

---

## Git Commits This Session

| Hash | Description |
|------|-------------|
| `cec97d1` | deploy: unified single-app — NestJS proxies Dashboard via @fastify/http-proxy |
| `98c44d5` | deploy: clean node_modules before install for fresh deps |
| `855b82d` | revert: remove unnecessary rm -rf from postinstall |
| `709107b` | fix: move prisma db push to startup (env vars unavailable during build) |
| `1d3fa81` | fix: move AuthProvider to root layout — fixes pre-render crash on /login |
| `eaf0d7c` | fix: restore .env to git, remove prisma db push from startup |
| `d9dac64` | config: .env with placeholders for Stripe/SMTP (set via Dashboard later) |
| `92379ef` | fix: kill stale port processes before starting — prevents EADDRINUSE loop |
| `9b2bd6a` | **fix: replace two-process proxy with static export — single process, single port** |
| `d8d5a9f` | fix: add generateStaticParams to all 9 dynamic [id] pages — split into server/client |
| `9a1dcec` | fix: BullMQ queue names `sratix:*` → `sratix-*` (colon not allowed as separator) |
| `e8b65a7` | fix: Stripe graceful degradation — skip init when key is empty, `ensureStripe()` guard |
| `f2780ef` | fix: replace setNotFoundHandler with onRequest hook — avoids NestJS conflict |
| `c29ee96` | rename: Client/ → sratix-client/, Control/ → sratix-control/ — match WP plugin slugs |

---

## Files Modified This Session

### Server Files (14 modified, 0 new)

| File | Changes |
|------|---------|
| `src/main.ts` | **Major rewrite** — removed `@fastify/http-proxy`, added `@fastify/static` for Dashboard/out/, SPA fallback via `onRequest` hook (not `setNotFoundHandler` — conflicts with NestJS) |
| `src/outgoing-webhooks/outgoing-webhooks.controller.ts` | Fixed `AuthGuard` pattern |
| `src/audit-log/audit-log.service.ts` | Prisma 6 JSON field casts |
| `src/forms/forms.service.ts` | Prisma 6 JSON field casts |
| `src/gdpr/gdpr.service.ts` | Prisma 6 JSON field casts |
| `src/orders/orders.service.ts` | Prisma 6 JSON field casts |
| `src/payments/stripe-webhook.controller.ts` | `expires_after` → `expires_at`, JSON casts |
| `src/outgoing-webhooks/outgoing-webhooks.service.ts` | JSON field casts |
| `src/badge-templates/badge-templates.service.ts` | JSON field casts |
| `src/payments/stripe.service.ts` | Stripe API version update + graceful degradation when key is empty (`ensureStripe()` guard) |
| `src/promo-codes/promo-codes.service.ts` | JSON field casts |
| `src/queue/queue.service.ts` | BullMQ queue names `sratix:*` → `sratix-*` (colon not allowed) |
| `src/tickets/tickets.service.ts` | **+Webhook dispatch** (`ticket.issued`, `ticket.voided`) |
| `src/tickets/tickets.module.ts` | +`OutgoingWebhooksModule` import |
| `src/check-ins/check-ins.service.ts` | **+Webhook dispatch** (`checkin.created`) |
| `src/check-ins/check-ins.module.ts` | +`OutgoingWebhooksModule` import |
| `src/attendees/attendees.service.ts` | **+Webhook dispatch** (`attendee.registered`) |
| `src/attendees/attendees.module.ts` | +`OutgoingWebhooksModule` import |

### Dashboard Files (7 modified, 1 new)

| File | Changes |
|------|---------|
| `next.config.ts` | **Converted to static export** — `output: 'export'`, `trailingSlash: true`, removed rewrites |
| `src/lib/api.ts` | +Webhook types + 9 API methods |
| `src/lib/auth.ts` → `auth.tsx` | Renamed (.ts → .tsx for JSX support) |
| `src/app/layout.tsx` | +`AuthProvider` wrapper (moved from dashboard layout) |
| `src/app/page.tsx` | Converted to client component (`'use client'` + `router.replace`) |
| `src/app/dashboard/layout.tsx` | Removed `AuthProvider` (now in root layout) |
| `src/components/sidebar.tsx` | +Webhooks nav item |
| `src/app/dashboard/events/[id]/webhooks/page.tsx` | **NEW** — Full webhook management page |
| `src/app/dashboard/events/[id]/*/client.tsx` (×9) | **NEW** — Client components extracted from page.tsx for static export |
| `src/app/dashboard/events/[id]/*/page.tsx` (×9) | **REWRITTEN** — Server wrappers with `generateStaticParams` returning `[{ id: '_' }]` |

### Root Files (3 modified, 1 created)

| File | Changes |
|------|---------|
| `package.json` | **Multiple iterations** — final: `start` = `cd Server && node dist/main.js` |
| `.gitignore` | Removed `.env` exclusion, added `.next/`, `*.tsbuildinfo` |
| `start.js` | Created then deprecated — still in repo but unused |
| `Server/.env` | Stripe/SMTP keys set to empty placeholders |

### Dependencies Changed

| Package | Action | Reason |
|---------|--------|--------|
| `satori` | Installed in Server | Badge rendering (declared Session 5, missing) |
| `@resvg/resvg-js` | Installed in Server | SVG→PNG conversion for badges |
| `@fastify/static` | Installed in Server | Serve Dashboard static files |
| `@fastify/http-proxy` | **Removed** from Server | No longer needed (was proxy to Dashboard SSR) |

---

## Outstanding Items

### Must Do Before Production

| Priority | Task | Notes |
|----------|------|-------|
| ~~**P0**~~ | ~~Verify Infomaniak rebuild~~ | ✅ Server running — Dashboard login page confirmed live |
| **P0** | `prisma db push` via SSH | Creates 4 new tables: `badge_templates`, `badge_renders`, `webhook_endpoints`, `webhook_deliveries` |
| **P0** | Set real JWT/WP secrets | Currently using dev placeholders — insecure |
| **P1** | Dashboard settings page | Store Stripe keys + SMTP creds via UI (not .env) |
| **P1** | Set Stripe webhook endpoint | `https://tix.swiss-robotics.org/webhooks/stripe` in Stripe Dashboard |

### Cleanup

| Task | Notes |
|------|-------|
| Delete `start.js` | Orphaned — no longer referenced by any script |
| Add `CORS` origin for Dashboard | Dashboard served from same origin now (no CORS needed for SPA), but WP sites still need it |
| Test SSE from static Dashboard | `EventSource` requires same-origin or CORS — should work since Dashboard is served from same port |

---

## Phase 2 Checklist — Updated

| Item | Status |
|------|--------|
| Badge template system (satori pipeline) | ✅ Session 5 |
| BullMQ job queue infrastructure | ✅ Session 5 |
| Outgoing webhook system | ✅ Session 5 |
| **Dashboard: webhook management page** | **✅ Session 6** |
| **WP plugin sync webhooks (ticket.issued → Client)** | **✅ Session 6** |
| Check-in scanner page (camera QR) | ⬜ |
| Multi-scanner management | ⬜ |
| Waitlist with auto-promotion | ⬜ |
| Bulk operations (email, badges, void) | ⬜ |
| Dashboard: badge template editor | ⬜ |
| Dashboard: queue monitoring page | ⬜ |
| Dashboard: settings page (Stripe/SMTP) | ⬜ |
| Email queue integration (send via BullMQ) | ⬜ |
| Badge batch rendering via queue | ⬜ |

---

## Project Totals

| Metric | Session 5 | Session 6 |
|--------|-----------|-----------|
| Server TypeScript files | 72 | 72 |
| NestJS modules | 22 | 22 |
| Prisma models | 20 | 20 |
| REST API endpoints | ~65 | ~65 |
| Dashboard TypeScript/TSX files | 22 | 33 |
| Dashboard pages | 11 | 12 |
| WP plugin folders | `Client/`, `Control/` | `sratix-client/`, `sratix-control/` |
| Git commits (total) | ~10 | 25 |
| Phase 1 items | 19/19 ✅ | 19/19 ✅ |
| Phase 2 items done | 3 | **5** |
| Deployment status | Not deployed | ✅ Live on Infomaniak |
