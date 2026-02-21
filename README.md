# SRAtix

Event ticketing and registration platform for the **Swiss Robotics Association (SRA)**.

Built and maintained by **TAROS Web Services**.

---

## Architecture

SRAtix is a three-component monorepo served from a single Node.js process:

```
SRAtix/
├── Server/          # NestJS (Fastify) — REST API + static file server
├── Dashboard/       # Next.js 15 static SPA — admin dashboard
└── sratix-client/   # Lightweight embed script — public ticket purchase widget
```

| Component | Technology | Port |
|-----------|-----------|------|
| Server | NestJS + Fastify, Prisma, MariaDB | 3000 |
| Dashboard | Next.js 15 (`output: 'export'`), React 19, Tailwind CSS v4 | served by Server |
| Client widget | Vanilla JS embed (`sratix-embed.js`) | embedded in WP sites |

The Dashboard is pre-built to a static export and served by the Server via `@fastify/static`. There is no separate Node.js process for the frontend.

---

## Prerequisites

- Node.js 22+
- MariaDB 10.6+ (or MySQL 8)
- npm

---

## Setup

### 1. Install dependencies

```bash
cd Server && npm install
cd ../Dashboard && npm install
```

### 2. Configure environment

Copy and edit the environment file:

```bash
cp Server/.env.example Server/.env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | MariaDB connection string (`mysql://user:pass@host:3306/sratix`) |
| `JWT_SECRET` | Secret for signing access tokens (min 32 chars) |
| `REFRESH_SECRET` | Secret for signing refresh tokens (min 32 chars) |
| `COOKIE_SECRET` | Secret for `@fastify/cookie` HMAC signing (min 32 chars) |
| `WP_SHARED_SECRET` | Shared secret for WordPress ↔ SRAtix JWT bridge |
| `NODE_ENV` | `production` or `development` |

### 3. Run Prisma migrations

```bash
cd Server
npx prisma migrate deploy
```

### 4. Build the Dashboard

```bash
cd Dashboard
npm run build
```

The static export will be written to `Dashboard/out/`, which the Server picks up automatically.

### 5. Start the Server

```bash
cd Server
npm run start:prod
```

The server binds to `0.0.0.0:3000` by default. Set `PORT` to override.

---

## Development

### Server (hot-reload)

```bash
cd Server && npm run start:dev
```

### Dashboard (dev server on port 3100)

```bash
cd Dashboard && npm run dev
```

> Note: In development the Dashboard runs on a separate port (3100). Point your browser to `http://localhost:3100` and ensure the Server is also running on port 3000 so API calls resolve.

---

## Authentication

SRAtix uses a dual-token scheme:

- **Access token** — 15-minute JWT, sent in `Authorization: Bearer` header, held in memory only (never stored on disk or in localStorage)
- **Refresh token** — 7-day JWT, stored in an httpOnly `sratix_rt` cookie (`path: /api/auth`, `SameSite: Lax`, `Secure` in production)

### WordPress bridge

The WordPress plugin redirects users to `/login?token=<jwt>&refresh=<rt>`. The login page promotes the URL refresh token to the httpOnly cookie via `POST /api/auth/init-session`, then discards the URL parameters.

---

## API

All endpoints are prefixed `/api/`.

| Module | Prefix | Description |
|--------|--------|-------------|
| Auth | `/api/auth` | Login, token exchange, refresh, logout |
| Events | `/api/events` | CRUD for events |
| Ticket Types | `/api/events/:id/ticket-types` | Ticket type management |
| Orders | `/api/events/:id/orders` | Order management |
| Attendees | `/api/events/:id/attendees` | Attendee records |
| Tickets | `/api/events/:id/tickets` | Issued tickets + QR check-in |
| Webhooks | `/api/webhooks` | Webhook endpoints and delivery logs |
| Users | `/api/users` | User management (admin) |
| Health | `/health` | Server health check |

---

## Roles

Ten built-in roles (defined in `Server/src/users/users.service.ts → VALID_ROLES`):

`super_admin`, `org_admin`, `event_manager`, `ticket_manager`, `check_in_agent`,
`finance_viewer`, `reports_viewer`, `support_agent`, `api_user`, `readonly`

---

## Project Docs

Extended documentation lives in `Docs/`:

| File | Contents |
|------|---------|
| `PRODUCTION-ARCHITECTURE.md` | Full architecture design, data model principles, GDPR, security baseline |
| `UPGRADE-PLAN.md` | Prioritized implementation roadmap with technical decisions |
| `SCHEMA-OVERVIEW.md` | Prisma schema entity map and relationships |
| `API-REFERENCE.md` | Full REST API reference |

---

## License

Proprietary — © TAROS Web Services. All rights reserved.
