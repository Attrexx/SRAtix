# SRAtix Project Handoff — Session 1 (February 17, 2026)

## What Is SRAtix

A 3-component event ticketing platform for the Swiss Robotics Association (SRA), authored by TAROS Web Services:

- **SRAtix Server** — NestJS API on `tix.swiss-robotics.org` (Infomaniak Node.js hosting)
- **SRAtix Control** — WP plugin on `swiss-robotics.org` (admin dashboard, event management)
- **SRAtix Client** — WP plugin on `swissroboticsday.ch` (public ticket purchase, registration)

## Repository

- **GitHub**: `https://github.com/Attrexx/SRAtix.git` (private)
- **Git user**: TAROS Web Services `<dev@taros.ch>`
- **Local workspace**: `i:\test\!SRA Apps\SRAtix\`

## Workspace Structure

```
SRAtix/
├── package.json           # Root orchestrator — delegates to Server/
├── .gitignore             # node_modules/, dist/
├── README.md
├── Docs/
│   └── PRODUCTION-ARCHITECTURE.md   # 28-section canonical architecture doc (~1565 lines)
├── Tester/                # Hosting capability tester (temporary, deployed previously)
│   ├── package.json
│   ├── .env
│   └── src/
├── Server/                # NestJS Phase 1 server — LIVE ON tix.swiss-robotics.org
│   ├── package.json       # NestJS + Fastify + Prisma 6 + JWT + BullMQ
│   ├── .env               # DATABASE_URL, REDIS_URL, JWT_SECRET, WP_API_SECRET, etc.
│   ├── nest-cli.json
│   ├── tsconfig.json      # ES2022, commonjs, strict, decorators enabled
│   ├── tsconfig.build.json
│   ├── prisma/
│   │   └── schema.prisma  # 15 tables, Prisma 6.19.2, MySQL provider
│   └── src/
│       ├── main.ts         # Fastify adapter, dotenv preload, CORS, global prefix /api
│       ├── app.module.ts   # Root module importing all Phase 1 modules
│       ├── prisma/         # PrismaService (global) + PrismaModule
│       ├── health/         # GET /health — DB connectivity check (excluded from /api prefix)
│       ├── auth/           # JWT + RBAC: service, controller, jwt-strategy, roles-guard, decorators
│       ├── events/         # CRUD at /api/events with org scoping
│       ├── ticket-types/   # CRUD at /api/events/:eventId/ticket-types
│       ├── orders/         # CRUD at /api/orders with auto-generated order numbers
│       └── attendees/      # CRUD at /api/attendees with email lookup
├── sratix-control/        # WP plugin — NOT YET STARTED
└── sratix-client/         # WP plugin — NOT YET STARTED
```

## Infrastructure — CONFIRMED WORKING

| Component | Details |
|-----------|---------|
| **Node.js** | v24.13.0 on Infomaniak shared hosting, Linux x64 |
| **MariaDB 10.6** | `ks704.myd.infomaniak.com:3306`, db: `ks704_tix`, user: `ks704_tix`, pass: `B&7eRfVzmB8vzbL` (URL-encoded `&` as `%26`) |
| **Upstash Redis** | Free tier, EU, TLS. `rediss://default:ARv8AAImcDE2ZGEyNThjMmUwYTU0ZDQ5YTM3NDRjNjQwOGYzNTk5MnAxNzE2NA@topical-kite-7164.upstash.io:6379`. 10k cmds/day, 256MB |
| **Badge rendering** | satori + @resvg/resvg-js + pdf-lib (NOT Puppeteer — fails on shared hosting) |
| **Prisma** | v6.19.2 (NOT v7 — v7 constructor API is broken, no MySQL adapter exists) |

## Database Schema — 15 Tables (CREATED IN MARIADB)

`organizations`, `events`, `ticket_types`, `orders`, `order_items`, `attendees`, `tickets`, `form_schemas`, `form_submissions`, `check_ins`, `users`, `user_roles`, `audit_log`, `wp_mappings`, `settings`

## Infomaniak Deployment — CRITICAL DETAILS

**Build command** (standard):
```
git pull origin main && npm install && npm run build
```

**Build command** (when Prisma schema changes):
```
git pull origin main && npm install && npm run build && cd Server && npx prisma db push
```

**Start command**: `npm start`

**How it works**:
1. Root `package.json` has `postinstall`: `cd Server && npm install && npx prisma generate`
2. Root `build`: `cd Server && npm run build` (runs `nest build`)
3. Root `start`: `cd Server && node dist/main.js`

### Hosting Quirks Discovered

- **No env vars UI** — uses dotenv with committed `.env` (private repo)
- **No auto-git-pull** — build command must include `git pull origin main`
- **Proxy adds trailing slashes** — MUST have `ignoreTrailingSlash: true` on FastifyAdapter
- **CWD is repo root, not Server/** — dotenv path uses `join(__dirname, '..', '.env')` from `dist/`
- **MariaDB only accessible from hosting network** — `prisma db push` only works on server, not locally
- **NestJS dist output**: `dist/main.js` (NOT `dist/src/main.js`) with Prisma 6
- **Puppeteer fails** — missing system libs (libnspr4.so etc.), use satori pipeline instead

## Auth Architecture

- OAuth2-lite token exchange: WP plugins send HMAC-signed request → Server returns JWT pair
- 15min access tokens, 7day refresh tokens
- HMAC: `sha256(wpUserId:roles:sourceSite)` signed with `WP_API_SECRET`
- Roles: super_admin, event_admin, organization_admin, staff, box_office, gate_staff, scanner, viewer, exhibitor, attendee
- `@Roles()` decorator + `RolesGuard` (super_admin bypasses all)
- `@CurrentUser()` decorator extracts JWT payload

## Server .env Contents

```
DATABASE_URL=mysql://ks704_tix:B%267eRfVzmB8vzbL@ks704.myd.infomaniak.com:3306/ks704_tix
REDIS_URL=rediss://default:ARv8AAImcDE2ZGEyNThjMmUwYTU0ZDQ5YTM3NDRjNjQwOGYzNTk5MnAxNzE2NA@topical-kite-7164.upstash.io:6379
JWT_SECRET=sratix-dev-jwt-secret-change-me-before-production
JWT_REFRESH_SECRET=sratix-dev-refresh-secret-change-me-before-production
WP_API_SECRET=sratix-dev-wp-api-secret-change-me-before-production
NODE_ENV=development
PORT=3000
```

## Live Endpoints (confirmed working)

- `GET /` — `{"service":"SRAtix Server","version":"0.1.0","status":"running"}`
- `GET /health` — DB connectivity + uptime
- `POST /api/auth/token` — token exchange
- `GET|POST /api/events` — auth required
- `GET|POST /api/events/:id/ticket-types` — auth required
- `GET|POST /api/orders` — auth required
- `GET|POST /api/attendees` — auth required

## Architecture Doc

`Docs/PRODUCTION-ARCHITECTURE.md` is the canonical reference — 28 sections covering sync model, form schemas, payments (Stripe Checkout hosted, SAQ-A PCI), check-in with offline packs, badge rendering, RBAC, SSE real-time, and multi-tenancy. **Read it before making architectural decisions.**

## What's Next (Phase 1 remaining)

1. **Stripe Checkout** — payment intent + webhook handler in Orders module
2. **SSE endpoint** — real-time dashboard updates (check-in counts, sales)
3. **SRAtix Control WP plugin** — admin dashboard on swiss-robotics.org
4. **SRAtix Client WP plugin** — public ticket purchase on swissroboticsday.ch
5. Clean up diagnostic logging from main.ts (console.log statements)
6. Remove Tester/ directory (no longer needed)

## Context Notes

- The SRAtix project lives inside the larger `!SRA Apps` workspace which contains 10+ other SRA WordPress plugins. See `.github/copilot-instructions.md` for workspace overview. The other plugins are independent and not part of SRAtix.
- The `Docs/PRODUCTION-ARCHITECTURE.md` was updated throughout Session 1 to reflect all hosting test findings (satori replacing Puppeteer, MariaDB instead of PostgreSQL, Upstash Redis free tier constraints, etc.)
- All Tester results: 16 Pass / 0 Fail / 1 Warn / 0 Skip
