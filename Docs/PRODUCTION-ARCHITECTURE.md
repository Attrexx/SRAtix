# SRAtix — Production Architecture Document

> **Version:** 1.0
> **Date:** 2026-02-17
> **Author:** TAROS Web Services / AI Architecture Session
> **Status:** Pre-development — Architecture Finalized

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Three-Component Architecture](#2-three-component-architecture)
3. [Component Boundaries & Responsibilities](#3-component-boundaries--responsibilities)
4. [Technology Stack](#4-technology-stack)
5. [Database & Data Model Principles](#5-database--data-model-principles)
6. [Sync Model — References, Not Replication](#6-sync-model--references-not-replication)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Registration Forms — Versioned Schema Architecture](#8-registration-forms--versioned-schema-architecture)
9. [Payments, Invoicing & Financial Ledger](#9-payments-invoicing--financial-ledger)
10. [Badge Generation System](#10-badge-generation-system)
11. [Wallet Pass Generation](#11-wallet-pass-generation)
12. [Email & SMS Communications](#12-email--sms-communications)
13. [Real-Time Architecture](#13-real-time-architecture)
14. [Offline Check-In System](#14-offline-check-in-system)
15. [Dashboard — Single App, Context Switching](#15-dashboard--single-app-context-switching)
16. [SRA Ecosystem Integration](#16-sra-ecosystem-integration)
17. [Multi-Tenancy Design](#17-multi-tenancy-design)
18. [GDPR / nLPD Compliance](#18-gdpr--nlpd-compliance)
19. [Security Baseline](#19-security-baseline)
20. [Configuration Philosophy](#20-configuration-philosophy)
21. [Cloudflare Integration](#21-cloudflare-integration)
22. [Future Event App Readiness](#22-future-event-app-readiness)
23. [Phased Build Plan](#23-phased-build-plan)
24. [Risks & Mitigations](#24-risks--mitigations)
25. [Hosting Capability Testing](#25-hosting-capability-testing)
26. [Workspace Structure](#26-workspace-structure)
27. [Key Decisions Log](#27-key-decisions-log)

---

## 1. Project Overview

### What Is SRAtix?

SRAtix is a **multi-component event ticketing and registration platform** built for the Swiss Robotics Association (SRA). It replaces ad-hoc ticketing workflows with a purpose-built system comparable to [Swicket.io](https://swicket.io/features) in capability scope.

### Why Build Custom?

- SRA events (primarily Swiss Robotics Day) require **complex, variable registration forms** that collect data points for a future event app
- Tight integration with existing SRA WordPress ecosystem (ProfileGrid, WP Job Manager, SRA MAP, Company Profiles)
- Need for **real-time operations** (check-in, capacity monitoring, live dashboards)
- Future **PWA/native event app** requires clean API-first architecture
- Data sovereignty requirements (Swiss nLPD compliance)
- Cost control vs. SaaS ticketing platforms

### Core Capability Targets (Swicket-comparable)

- Invoicing & financial management
- Email (and future SMS) notifications & communications
- Badge generation with complex designs
- Form customization (simple → very complex)
- Attendee / ticket / track / format variety support
- Check-in and badge automations with offline support
- On-site operations
- Apple/Google Wallet pass support
- Stripe card payments (live & test modes)
- Lead capturing
- KPIs and detailed metrics
- Top-notch security across all flows
- GDPR/nLPD compliance
- Real-time data monitoring, metrics, and storage/backup

---

## 2. Three-Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      SRAtix Server                           │
│                tix.swiss-robotics.org                         │
│                                                               │
│  ┌───────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────┐  │
│  │  REST API  │ │   SSE    │ │ Dashboard │ │   Workers    │  │
│  │  (public)  │ │(realtime)│ │ (Next.js) │ │  (BullMQ)    │  │
│  └───────────┘ └──────────┘ └───────────┘ └──────────────┘  │
│  ┌───────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────┐  │
│  │  Stripe   │ │ Email/   │ │ Badge Gen │ │  Wallet Pass │  │
│  │  Gateway  │ │ SMS      │ │ (Puppeteer)│ │  Generator   │  │
│  └───────────┘ └──────────┘ └───────────┘ └──────────────┘  │
│                                                               │
│                  PostgreSQL + Redis                           │
└──────────┬────────────────────────────┬──────────────────────┘
           │ REST + Webhooks            │ REST + Webhooks
           ▼                            ▼
┌─────────────────────┐     ┌────────────────────────────┐
│   SRAtix Control    │     │      SRAtix Client         │
│ swiss-robotics.org  │     │   swissroboticsday.ch      │
│                     │     │                            │
│ • WP Plugin (thin)  │     │ • WP Plugin (thin)         │
│ • Identity + perms  │     │ • Checkout UX embedding    │
│ • Ecosystem linking │     │ • Attendee self-service    │
│ • Member/CPT sync   │     │ • Event-specific content   │
│ • Token exchange    │     │ • Kiosk mode (check-in)    │
│ • Webhook receiver  │     │ • Event dashboard (scoped) │
│ • Entity creation   │     │ • Webhook receiver         │
└─────────────────────┘     └────────────────────────────┘
           ▲                            ▲
           │                            │
           ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│                Future: SRAtix Event App                      │
│                    (PWA → Native)                             │
│                                                               │
│  • Personalized schedule    • Networking features            │
│  • Real-time updates        • Offline-first                  │
│  • Badge wallet             • Lead scanning                  │
│  • Push notifications       • Interactive sessions           │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Component Boundaries & Responsibilities

### SRAtix Server — Single Source of Truth

The Server is the **canonical authority** for all ticketing data. It owns and manages:

| Domain | What It Owns |
|--------|-------------|
| **Events** | Event creation, configuration, lifecycle |
| **Orders** | Order creation, status, history |
| **Invoices** | Generation, numbering, PDF rendering, Swiss QR-bill |
| **Tickets** | Issuance, types, pricing, promo codes, capacity |
| **Attendees** | Registration data, check-in state, preferences |
| **Check-ins** | Online + offline check-in state, conflict resolution |
| **Badge Templates** | Design, rendering, dynamic element placement |
| **Communications** | Email/SMS templates, dispatch, delivery logs |
| **Exports** | Data exports (CSV, JSON, PDF) |
| **Audit Trail** | Immutable log of all actions (who, what, when, from where) |
| **Forms** | Schema definitions, versioning, submission storage |
| **Analytics** | KPIs, metrics, real-time counters |
| **Payments** | Stripe integration, refunds, financial ledger |
| **Wallet Passes** | Apple/Google Wallet generation and updates |
| **Dashboard** | Admin/exhibitor/sponsor UI (Next.js SPA) |
| **API** | All REST endpoints consumed by Control, Client, and future apps |
| **Auth** | JWT token issuance, RBAC enforcement, session management |
| **File Storage** | Badge PDFs, invoice PDFs, uploaded assets (via Cloudflare R2) |

### SRAtix Control — Thin WP Connector (swiss-robotics.org)

Control is a **lightweight WordPress plugin**. It does NOT duplicate business logic. It:

- **Stores API credentials** (scoped, encrypted) for Server communication
- **Maintains mapping tables**: `wp_user_id ↔ sratix_actor_id`, CPT entity ↔ SRAtix org/exhibitor/partner IDs
- **Syncs WP user/member data → Server** on profile updates, membership changes, group changes
- **Exposes SRA-specific data** to Server (ProfileGrid groups, membership tiers, company profiles)
- **Receives webhooks from Server** (e.g., "registration confirmed" → update user meta)
- **Provides WP Admin page** that links to / iframes the Server dashboard
- **Handles token exchange**: WP user clicks "SRAtix Dashboard" → Control authenticates them to Server via OAuth2-lite signed token exchange
- **Creates SRA MAP entities** when Server requests it (exhibitor/partner/sponsor without existing entity)
- **Maps existing SRA CPTs** (`corporate-member`, `sra_entity`) to Server's data model

### SRAtix Client — Thin WP Connector (swissroboticsday.ch)

Client is a **lightweight WordPress plugin**. It:

- **Embeds registration forms** rendered by Server (via JS widget injection, similar to `sra-member-badges` embed pattern)
- **Provides shortcodes/Gutenberg blocks** for ticket pages, schedule pages, speaker pages
- **Offers lightweight attendee self-service** ("My Tickets" via Server API)
- **Handles event-specific WordPress content** around the embedded ticketing flows
- **Provides check-in kiosk mode** (staff-facing PWA page)
- **Receives webhooks from Server** for event-specific updates
- **Stores current event ID** and embed configuration
- Does **NOT** process payments — that's Server-side via Stripe

### Critical Rule

> **The moment WordPress becomes authoritative for orders/tickets/attendees, you'll fight consistency forever.** WordPress sites are presentation + light orchestration. Server is the single source of truth.

---

## 4. Technology Stack

### SRAtix Server

```
Runtime:          Node.js 24 (v24.13.0 confirmed on hosting)
Framework:        NestJS (TypeScript) — structured, batteries-included
                  OR Fastify + clean architecture (leaner alternative)
Database:         MariaDB 10.6 (Infomaniak shared hosting)
                  Host: ks704.myd.infomaniak.com:3306
                  Relational integrity for tickets/invoices/financials/auditing
                  JSON columns for flexible form submissions
                  Generated columns for indexed JSON field extraction
Cache/Queue:      Upstash Redis (free tier — 10k commands/day, 256MB)
                  redis://...@upstash-endpoint:6379
                  Upgrade path: local Redis when moving to Cloud Server
ORM:              Prisma (type-safe, great migrations, schema-first)
                  Provider: "mysql" (MariaDB compatible)
Auth:             OAuth2-lite token exchange + JWT + RBAC
Real-time:        SSE (Server-Sent Events) for live dashboards/counters
                  WebSockets ONLY for bi-directional needs (future event app)
Dashboard UI:     Next.js (SSR for public pages + SPA for admin dashboard)
                  Served from same subdomain via path-based routing:
                    tix.swiss-robotics.org/api/* → NestJS/Fastify
                    tix.swiss-robotics.org/*     → Next.js
Email:            Nodemailer + MJML templates
                  Initially SMTP, later swap to SendGrid/Postmark
                  Abstracted behind EmailTransport interface
SMS:              Twilio (future, behind same transport abstraction)
Payments:         Stripe SDK (Checkout for v1 — minimal PCI scope, SAQ-A)
Badge Gen:        Puppeteer (HTML/CSS templates → PDF)
                  Templates = HTML files with placeholder tokens
                  Supports images, color-coding, dynamic layouts
                  NOTE: Chromium not pre-installed — use bundled Puppeteer
Wallet Passes:    passkit-generator (Apple) + google-wallet (Google)
File Storage:     Cloudflare R2 (badge PDFs, invoice PDFs, uploads)
CDN:              Cloudflare (free tier)
Bot Protection:   Cloudflare Turnstile (free, replaces reCAPTCHA)
Logging:          Pino (structured JSON logging)
Process Manager:  PM2 (auto-restart, clustering)
Background Jobs:  BullMQ (Upstash Redis-backed) — email dispatch, PDF gen,
                  badge rendering, sync jobs, scheduled tasks
```

### SRAtix Control (WP Plugin)

```
Language:         PHP 8.x
Pattern:          Standard SRA plugin structure (loader pattern)
Dependencies:     WordPress REST API client → Server
                  Webhook receiver (registered REST routes)
                  WP Admin integration (settings page, dashboard link)
                  User/member sync hooks (ProfileGrid, WooCommerce)
```

### SRAtix Client (WP Plugin)

```
Language:         PHP 8.x
Pattern:          Standard SRA plugin structure (loader pattern)
Dependencies:     JS widget embed (registration forms from Server)
                  Shortcodes / Gutenberg blocks
                  Webhook receiver
                  Event-specific admin settings page
```

### Why Node.js Over PHP for the Server

The deciding factors specific to this project:

1. **Real-time requirements** — Live check-in dashboards, capacity monitoring, event app sync. Node.js handles persistent connections (SSE/WebSockets) natively. PHP requires bolt-on solutions (Ratchet, Swoole) that fight the stateless request/response model.

2. **Event-driven architecture** — Offline check-in sync, webhook processing, queue-based jobs. Node.js is ergonomically built for event-driven patterns.

3. **Future event app** — PWA (and potentially native) app shares the JS/TS ecosystem. Potential for shared validation logic, type definitions, and SDK generation.

4. **API-first design** — NestJS/Fastify are built for API servers. Clean decorator-based routing, built-in validation, OpenAPI generation.

5. **Background workers** — BullMQ provides robust job queues without additional infrastructure (just Redis). Email blasts, badge rendering, invoice generation, data exports — all handled as background jobs.

6. **Ecosystem** — Stripe SDK, Puppeteer, passkit-generator, google-wallet, MJML — all Node.js-native with mature, maintained packages.

---

## 5. Database & Data Model Principles

### MariaDB 10.6 as Primary Store

MariaDB available on Infomaniak shared hosting (`ks704.myd.infomaniak.com:3306`). Chosen for:
- **Relational integrity** — tickets reference orders reference attendees reference events. Foreign keys (InnoDB) fully supported.
- **JSON columns** — form submission data stored as JSON type. Key fields extracted to generated/virtual columns for indexing.
- **Full-text search** — MariaDB FULLTEXT indexes on InnoDB tables for attendee/order searching.
- **Audit triggers** — database-level audit logging supported.
- **Zero latency** — same hosting infrastructure as the Node.js app, no external network hop.
- **No extra cost** — included in hosting plan.
- **Prisma support** — Prisma ORM fully supports MariaDB via the `mysql` provider.

**What we lose vs PostgreSQL and how we compensate:**

| PostgreSQL Feature | MariaDB Compensation |
|---|---|
| JSONB + GIN indexes | JSON column + generated columns for indexed field extraction |
| Row-level security | Middleware-enforced tenant isolation (already planned) |
| `pgBoss` queue | BullMQ with Upstash Redis instead |
| Array columns | JSON arrays or junction tables |
| UUID primary key type | `CHAR(36)` for UUIDs, or `BIGINT AUTO_INCREMENT` with UUID as secondary unique column |

**Upgrade path**: If SRAtix moves to Infomaniak Cloud Server in the future, PostgreSQL can be installed natively. Prisma schema migration between providers is manageable.

### Multi-Tenancy from Day 1

Every table that holds tenant-scoped data includes:

```sql
event_id    CHAR(36) NOT NULL,   -- UUID stored as string
org_id      CHAR(36) NOT NULL,   -- UUID stored as string
-- Foreign keys via InnoDB
CONSTRAINT fk_event FOREIGN KEY (event_id) REFERENCES events(id),
CONSTRAINT fk_org FOREIGN KEY (org_id) REFERENCES organizations(id)
```

> **Note**: MariaDB lacks a native UUID type. UUIDs stored as `CHAR(36)`. Prisma handles this transparently with `@db.Char(36)` annotation. Alternative: use `BIGINT AUTO_INCREMENT` PKs with UUID as a secondary unique indexed column for external references.

Tenant isolation enforced at the **query middleware layer** — every database call automatically scoped by the authenticated tenant context. This is not optional; it's baked into the ORM query builder.

### Key Tables (Conceptual)

```
organizations          -- SRA, partner orgs, exhibitor companies
events                 -- multi-tenant event records
ticket_types           -- per-event ticket configurations
orders                 -- purchase records
order_items            -- line items per order
tickets                -- issued tickets (one per attendee per ticket_type)
attendees              -- registered individuals
registrations          -- links attendee → event with form submission data
form_schemas           -- versioned form definitions (JSON)
form_submissions       -- attendee answers + schema_version reference
check_ins              -- check-in events (timestamp, device, method)
check_in_packs         -- offline check-in dataset snapshots
badge_templates        -- HTML/CSS badge designs per event/ticket_type
badge_renders          -- generated badge PDFs/images
invoice_ledger         -- APPEND-ONLY financial ledger (see §9)
invoices               -- generated invoice documents
payments               -- Stripe payment records
refunds                -- refund records
promo_codes            -- discount/promo code definitions
communications         -- email/SMS dispatch log
comm_templates         -- message templates (MJML for email)
wallet_passes          -- Apple/Google wallet pass records
sessions               -- event sessions/tracks/timeslots
session_registrations  -- attendee ↔ session assignments
lead_captures          -- exhibitor badge scans
audit_log              -- immutable action log
users                  -- dashboard user accounts
roles                  -- RBAC role definitions
permissions            -- role ↔ permission mappings
user_roles             -- user ↔ role ↔ scope (event/org) assignments
settings               -- key-value config per event/org/global
wp_mappings            -- wp_user_id ↔ sratix_actor_id + CPT entity mappings
```

### Redis Usage (Upstash Free Tier)

Upstash Redis (free tier: 10,000 commands/day, 256MB, EU region available).
Connects via TLS. Compatible with `ioredis` and BullMQ.

```
Queues:         BullMQ job queues (email, PDF, badge, sync, export)
Caching:        Event config, ticket availability counters
Rate Limiting:  API endpoint rate counters
Sessions:       Dashboard user sessions (fast lookup, auto-expiry)
Pub/Sub:        Real-time event broadcasting (SSE fan-out)
Locks:          Distributed locks for payment processing (prevent double-charge)
```

**Command budget (free tier)**: 10k/day is sufficient for development and low-volume
production. At scale (event day with 1000+ check-ins), upgrade to Upstash Pay-as-you-go
($0.2/100k commands) or migrate to local Redis on Cloud Server.

**Upgrade path**: When moving to Infomaniak Cloud Server, install local Redis and
change `REDIS_URL` to `redis://localhost:6379` — zero code changes.

---

## 6. Sync Model — References, Not Replication

### Core Principle

> **Do NOT "sync databases." Sync references + snapshots.**

SRAtix Server is authoritative for ticketing. WordPress is authoritative for WP content. They exchange **references**, not copies.

### What Each Side Stores

**SRAtix Control plugin (WP side) stores:**
```
wp_usermeta:
  sratix_actor_id          → Server's actor/user UUID
  sratix_last_sync         → timestamp of last profile push

wp_options:
  sratix_api_url           → https://tix.swiss-robotics.org/api
  sratix_api_key           → encrypted server-to-server key
  sratix_webhook_secret    → HMAC secret for incoming webhooks

Custom mapping table (wp_sratix_mappings):
  wp_entity_type           → 'user' | 'corporate-member' | 'sra_entity'
  wp_entity_id             → WP post/user ID
  sratix_entity_type       → 'organization' | 'exhibitor' | 'partner' | 'sponsor'
  sratix_entity_id         → Server UUID
```

**SRAtix Client plugin (WP side) stores:**
```
wp_options:
  sratix_api_url           → Server URL
  sratix_api_key           → encrypted key
  sratix_webhook_secret    → HMAC secret
  sratix_current_event_id  → UUID of active event
  sratix_embed_config      → widget display settings
```

**SRAtix Server stores:**
```
wp_mappings table:
  source_site              → 'swiss-robotics.org' | 'swissroboticsday.ch'
  wp_entity_type           → 'user' | 'post'
  wp_entity_id             → WP ID
  sratix_entity_type       → internal entity type
  sratix_entity_id         → internal UUID
  last_synced_at           → timestamp
```

### Sync Triggers (Event-Driven, Not Polling)

| Event | Direction | Mechanism |
|-------|-----------|-----------|
| WP user profile updated | WP → Server | Control plugin fires webhook to Server |
| WP membership changed | WP → Server | Control plugin fires webhook to Server |
| New registration confirmed | Server → WP | Server fires webhook to Control |
| Attendee data updated | Server → WP | Server fires webhook to Control |
| Exhibitor registered (no entity) | Server → WP | Server requests entity creation via Control API |
| Entity created in WP | WP → Server | Control fires webhook with new entity data |

### Read-Only Projections (Optional)

If WP needs "WP-native reporting pages," Control can periodically pull **read-only snapshots** from Server API. These are cached projections, never authoritative.

---

## 7. Authentication & Authorization

### OAuth2-Lite Token Exchange

Architecture follows an OAuth2-like flow for WP ↔ Server authentication:

```
┌────────────┐     ┌─────────────┐     ┌──────────────┐
│  WP User   │     │   Control   │     │   SRAtix     │
│  Browser   │     │   Plugin    │     │   Server     │
└─────┬──────┘     └──────┬──────┘     └──────┬───────┘
      │                   │                    │
      │  Click "Dashboard"│                    │
      ├──────────────────►│                    │
      │                   │                    │
      │                   │  POST /auth/token  │
      │                   │  {wp_user_id,      │
      │                   │   wp_roles,        │
      │                   │   signature}       │
      │                   ├───────────────────►│
      │                   │                    │
      │                   │  {access_token,    │
      │                   │   refresh_token,   │
      │                   │   expires_in}      │
      │                   │◄───────────────────┤
      │                   │                    │
      │  Redirect to      │                    │
      │  dashboard?token= │                    │
      │◄──────────────────┤                    │
      │                   │                    │
      │  Bearer token in  │                    │
      │  all API calls    │                    │
      ├──────────────────────────────────────►│
      │                   │                    │
```

**Key rules:**
- Control plugin uses a **server-to-server secret** to sign token requests
- Tokens are **short-lived** (15 min access, 7 day refresh)
- Tokens are **scoped** (per-event, per-role)
- **No long-lived tokens in browser storage** — use httpOnly cookies or short-lived memory tokens
- Server verifies the signature, maps `wp_user_id` to internal user, issues JWT with embedded roles/scopes

### RBAC — Role-Based Access Control

Roles are scoped per event AND per organization:

| Role | Scope | Capabilities |
|------|-------|-------------|
| **Super Admin** | Platform-wide (Server-native) | Full platform access, all events, all orgs, system settings |
| **Event Admin** | Single event | Event config, attendee management, check-in, comms, analytics |
| **Organization Admin** | Single organization | Manage org's exhibitor/sponsor/partner data across events |
| **Exhibitor** | Single event + org (synced from WP `corporate-member` CPT) | Own booth data, lead capture, badge scanning, org-scoped analytics |
| **Sponsor** | Single event + org (synced from WP) | Branding assets, impression analytics, lead data |
| **Partner** | Single event + org (synced from WP) | Limited analytics, co-branding |
| **Staff** | Single event | Check-in operations, attendee assistance, on-site ops |
| **Volunteer** | Single event | Check-in scanning only |
| **Scanner** | Single event | QR scan + check-in only (kiosk/device accounts) |
| **Attendee** | Single event (created at registration) | Own ticket, schedule, badge, profile |

**Permission checks at API layer, not UI.** Every API endpoint enforces permissions via middleware/guards (NestJS guards pattern). UI merely hides elements the user can't access — security is never UI-only.

---

## 8. Registration Forms — Versioned Schema Architecture

### Why Versioned Schemas?

Registration forms can vary from simple (name, email, ticket type) to very complex (dietary, accessibility, research interests, company details, session preferences, networking opt-ins, custom fields for event app personalization). Forms may change mid-event (new fields added, options modified).

**Requirements:**
- GDPR: prove what the user saw and consented to at submission time
- Data integrity: form changes mid-event don't corrupt historical data or exports
- Event app compatibility: app knows exactly which schema to render/consume
- Auditability: every submission tied to its exact form version

### Schema Structure

```jsonc
// Form Schema (stored in form_schemas table)
{
  "id": "uuid",
  "event_id": "uuid",
  "version": 3,
  "name": "SRD 2026 Registration",
  "created_at": "2026-02-17T10:00:00Z",
  "fields": [
    {
      "id": "field_name",
      "type": "text",           // text, email, phone, select, multi-select,
                                 // checkbox, radio, textarea, date, file,
                                 // number, country, canton, consent, group
      "label": { "en": "Full Name", "de": "Vollständiger Name", "fr": "Nom complet" },
      "required": true,
      "validation": { "minLength": 2, "maxLength": 100 },
      "requiredJustification": "Identity verification",  // GDPR: why is this field required?
      "section": "personal",
      "order": 1,
      "conditions": []          // conditional display rules
    },
    {
      "id": "field_dietary",
      "type": "multi-select",
      "label": { "en": "Dietary Requirements" },
      "options": [
        { "value": "vegetarian", "label": { "en": "Vegetarian" } },
        { "value": "vegan", "label": { "en": "Vegan" } },
        { "value": "halal", "label": { "en": "Halal" } },
        { "value": "gluten_free", "label": { "en": "Gluten-free" } }
      ],
      "required": false,
      "section": "logistics",
      "order": 10,
      "conditions": [
        { "field": "ticket_type", "operator": "in", "value": ["full_day", "vip"] }
      ]
    },
    {
      "id": "consent_marketing",
      "type": "consent",
      "label": { "en": "I agree to receive marketing communications from SRA" },
      "required": false,
      "consentPurpose": "marketing",
      "section": "consent",
      "order": 100
    }
  ],
  "sections": [
    { "id": "personal", "label": { "en": "Personal Information" }, "order": 1 },
    { "id": "professional", "label": { "en": "Professional Details" }, "order": 2 },
    { "id": "logistics", "label": { "en": "Event Logistics" }, "order": 3 },
    { "id": "consent", "label": { "en": "Consent & Privacy" }, "order": 4 }
  ],
  "ticketTypeFieldMappings": {
    "vip": ["field_dietary", "field_networking_interests", "field_session_prefs"],
    "exhibitor": ["field_company", "field_booth_size", "field_power_requirements"],
    "general": ["field_dietary"]
  }
}
```

### Submission Storage

```jsonc
// Form Submission (stored in form_submissions table)
{
  "id": "uuid",
  "registration_id": "uuid",
  "attendee_id": "uuid",
  "event_id": "uuid",
  "schema_id": "uuid",
  "schema_version": 3,         // CRITICAL: links to exact form version
  "submitted_at": "2026-03-15T14:30:00Z",
  "ip_address": "hashed",      // hashed for privacy, retained for fraud detection
  "answers": {
    "field_name": "Jane Doe",
    "field_dietary": ["vegetarian", "gluten_free"],
    "consent_marketing": { "granted": true, "timestamp": "2026-03-15T14:30:00Z" }
  },
  "normalized_fields": {
    // Key fields extracted for efficient querying (indexed columns)
    "email": "jane@example.com",
    "organization": "ETH Zurich",
    "ticket_type": "full_day",
    "dietary_flags": ["vegetarian", "gluten_free"],
    "consent_marketing": true,
    "consent_marketing_at": "2026-03-15T14:30:00Z"
  }
}
```

### Implementation Approach

1. **Phase 1**: Forms defined as JSON schemas, edited by admin in a JSON/YAML editor or structured settings page
2. **Phase 2+**: Visual form builder UI in the dashboard (drag-and-drop field arrangement, conditional logic builder) that generates the same JSON schema format underneath
3. Forms are **rendered by the Server** and embedded in the Client site via JS widget injection
4. Form logic (conditional fields, validation, pricing rules) lives in the Server, not in WordPress

---

## 9. Payments, Invoicing & Financial Ledger

### Stripe Integration Flow

```
Registration Form (Client embed)
  → Server API: create registration + Stripe PaymentIntent
  → Stripe Checkout (hosted by Stripe — minimal PCI scope, SAQ-A)
  → User completes payment on Stripe-hosted page
  → Stripe webhook → Server: payment confirmed
  → Server: finalize order, issue ticket, generate badge, create wallet pass
  → Server: send email confirmation (queued via BullMQ)
  → Server webhook → Control: update WP user meta with ticket info
```

### Stripe Configuration

- **Stripe Checkout** (hosted) for Phase 1 — handles SCA/3DS automatically, reduces PCI scope
- **Stripe Elements** (embedded) as Phase 2+ option for more integrated UX
- **Dual mode**: `STRIPE_MODE=test|live` environment toggle swaps API keys. Both modes can run simultaneously (test events vs live events)
- **Refunds**: Automated via Server dashboard using Stripe Refund API
- **Stripe Invoicing API**: For automated invoice generation with Swiss-compliant formatting

### Immutable Financial Ledger

> **Critical architectural decision**: Maintain an append-only financial ledger independent of Stripe's records.

```sql
CREATE TABLE invoice_ledger (
  id              UUID PRIMARY KEY,
  event_id        UUID NOT NULL,
  order_id        UUID NOT NULL,
  entry_type      VARCHAR(50) NOT NULL,  -- 'charge', 'refund', 'credit_note',
                                          -- 'adjustment', 'void'
  amount_cents    INTEGER NOT NULL,       -- always in smallest currency unit
  currency        VARCHAR(3) NOT NULL,    -- 'CHF', 'EUR'
  description     TEXT,
  stripe_ref      VARCHAR(255),           -- Stripe charge/refund ID
  invoice_number  VARCHAR(50),            -- sequential, never reused
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,          -- user/system who created entry
  metadata        JSONB                   -- additional context
  -- NO UPDATE OR DELETE ALLOWED — append only
);
```

**Why this matters:**
- Dispute resolution: complete financial history independent of Stripe
- Audit compliance: Swiss accounting requirements
- nLPD data retention: controlled retention separate from Stripe's policies
- Organization billing: exhibitors get consolidated invoices (booth + tickets + extras)
- Offline invoice generation capability

### Invoice Features

- Sequential invoice numbering (never reused, never gaps)
- Swiss QR-bill support (for CHF payments)
- VAT number display
- Organization billing details
- Proforma vs final invoice distinction
- Credit note generation for refunds
- PDF rendering via Puppeteer (HTML → PDF with Swiss formatting)

---

## 10. Badge Generation System

### Architecture

Badges use **HTML/CSS templates rendered to PDF via Puppeteer**. This is chosen over PDFKit because:
- Complex designs with images, color-coding, dynamic layouts are natural in HTML/CSS
- Designers can create templates using standard web technologies
- Hot-reload during template development
- Same rendering engine for screen preview and print output

### Template System

```
badge_templates/
├── srd-2026-general.html      # HTML template with {{placeholder}} tokens
├── srd-2026-vip.html
├── srd-2026-exhibitor.html
├── srd-2026-speaker.html
└── assets/
    ├── backgrounds/           # Pre-made template backgrounds
    │   ├── general-bg.png
    │   ├── vip-bg.png
    │   └── exhibitor-bg.png
    ├── logos/
    └── fonts/
```

### Dynamic Elements

Templates support:
- **Background images** (pre-designed, per ticket type / color-coded)
- **Attendee photo** (uploaded during registration or pulled from profile)
- **QR code** (ticket ID + HMAC signature for offline validation)
- **Dynamic text** (name, company, title, ticket type, track)
- **Color-coded elements** (borders, backgrounds by ticket category)
- **Custom fields** (any form field can be mapped to a badge area)
- **Media elements** (sponsor logos, event branding)

### Badge Builder UI (Phase 2+)

Dashboard provides a visual badge designer where admins:
- Select a background template
- Position dynamic elements on a canvas (drag-and-drop)
- Map form fields to badge regions
- Preview with sample data
- The builder generates the HTML template file underneath

### Rendering Pipeline

```
Badge Request → BullMQ Job Queue → Puppeteer Worker
  → Load HTML template
  → Inject attendee data into placeholders
  → Generate QR code (ticket_id + HMAC signature)
  → Render to PDF (print-ready, specified dimensions)
  → Upload to Cloudflare R2
  → Store R2 URL in badge_renders table
  → Notify attendee (email with download link)
```

---

## 11. Wallet Pass Generation

### Apple Wallet (via `passkit-generator`)

- Pass type: Event Ticket
- Contains: attendee name, event name, date, venue, QR code
- Updatable via push notifications (gate changes, schedule updates)
- Signed with Apple Developer certificate

### Google Wallet (via `google-wallet` npm)

- Pass type: Event Ticket
- Same data as Apple Wallet
- Updatable via Google Wallet API
- Requires Google Pay API for Passes merchant account

### Delivery

- Wallet passes included in confirmation email (`.pkpass` for Apple, link for Google)
- Download available in attendee self-service portal
- Updateable: if event details change, push updates to installed passes

---

## 12. Email & SMS Communications

### Email Architecture

```
Email Request → BullMQ Job Queue → Email Worker
  → Load MJML template
  → Inject dynamic data (attendee name, ticket details, etc.)
  → Compile MJML → HTML
  → Send via EmailTransport interface
  → Log delivery status in communications table
```

### EmailTransport Abstraction

```typescript
interface EmailTransport {
  send(message: EmailMessage): Promise<DeliveryResult>;
  getStatus(messageId: string): Promise<DeliveryStatus>;
}

// Implementations:
class SmtpTransport implements EmailTransport { ... }      // Phase 1 (dev/testing)
class SendGridTransport implements EmailTransport { ... }  // Future
class PostmarkTransport implements EmailTransport { ... }  // Future
```

**Critical**: Abstract email sending behind this interface from day 1. Swapping SMTP → SendGrid/Postmark later becomes a config change, not a refactor.

### SMS (Future)

Same abstraction pattern:

```typescript
interface SmsTransport {
  send(message: SmsMessage): Promise<DeliveryResult>;
}

class TwilioTransport implements SmsTransport { ... }
```

### Communication Features

- **Templated messages**: MJML templates with variable substitution
- **Segmented sends**: filter by ticket type, check-in status, form answers
- **Scheduled sends**: queue messages for future delivery
- **Delivery logging**: every send logged with status, timestamps, message ID
- **Unsubscribe handling**: respect consent flags from form submissions
- **Rate limiting**: prevent accidental mass-send; require confirmation for large audiences

---

## 13. Real-Time Architecture

### SSE-First Strategy

**Server-Sent Events (SSE)** as the default real-time mechanism. Rationale:

- Most real-time needs are **server → client push only** (live counters, dashboard stats, check-in feed)
- SSE is simpler than WebSockets, works through more proxies/CDNs (including Cloudflare)
- Requires no special client library (native `EventSource` API)
- Auto-reconnects natively
- Lower infrastructure overhead

### SSE Use Cases

| Stream | Data | Consumers |
|--------|------|-----------|
| `events/{id}/check-ins` | Live check-in feed | Dashboard, check-in stations |
| `events/{id}/stats` | Capacity, revenue, registration velocity | Dashboard |
| `events/{id}/orders` | New order notifications | Dashboard |
| `events/{id}/alerts` | System alerts, capacity warnings | Dashboard, staff |

### WebSockets — Reserved for Bi-Directional Needs

WebSockets (via `ws` or Socket.IO) only when truly needed:
- Future event app: live polling, chat, interactive sessions
- Two-way check-in sync (offline devices reconciling in real-time)
- Collaborative editing scenarios (if ever needed)

### Implementation

```
Redis Pub/Sub → SSE Broadcaster → Connected Clients (EventSource)

Server Action (check-in, order, etc.)
  → Publish to Redis channel (event-scoped)
  → SSE broadcaster picks up message
  → Fan out to all connected SSE clients subscribed to that event
```

---

## 14. Offline Check-In System

### First-Class Subsystem, Not Bolted On

Offline check-in is designed as a core subsystem from the start, not added later.

### Check-In Pack Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  SRAtix     │     │  Check-In    │     │  Scanner     │
│  Server     │────►│  Pack Gen    │────►│  PWA/App     │
│             │     │  (Worker)    │     │  (IndexedDB) │
└─────────────┘     └──────────────┘     └──────────────┘
                                                │
                                         Offline QR Scan
                                                │
                                         Local Validation
                                         (HMAC verify)
                                                │
                                         Queue Check-In
                                         Event Locally
                                                │
                                         ───── Online ─────
                                                │
                                         Sync to Server
                                         (conflict resolution)
```

### Check-In Pack Contents

A check-in pack is a **scoped, encrypted dataset** downloaded to a scanner device:

```jsonc
{
  "event_id": "uuid",
  "pack_version": 42,
  "generated_at": "2026-06-15T06:00:00Z",
  "expires_at": "2026-06-16T00:00:00Z",
  "hmac_key": "base64-encoded-key",    // for QR signature validation
  "attendees": [
    {
      "ticket_id": "uuid",
      "attendee_name": "Jane Doe",
      "ticket_type": "vip",
      "organization": "ETH Zurich",
      "photo_url": "data:image/...",   // embedded if available
      "checked_in": false,
      "qr_token": "opaque-token"       // matches QR code content
    }
    // ... only attendees for this event, not full DB
  ],
  "encryption": "AES-256-GCM"          // pack encrypted at rest on device
}
```

### QR Code Design

QR code encodes:

```
{ticket_id}:{hmac_signature}
```

- `ticket_id`: unique ticket identifier (UUID or shorter opaque token)
- `hmac_signature`: HMAC-SHA256 of `ticket_id` using event-scoped secret key
- Scanner validates signature **locally** against the `hmac_key` in the check-in pack
- **No network required** for validation

### Conflict Resolution

- **Deterministic rule: first check-in wins**
- If two devices check in the same ticket offline, the earlier timestamp wins
- Conflicting check-ins are flagged in audit log for review
- Server is the final arbiter when offline devices sync

### Scanner PWA Features

- Download check-in pack (encrypted, stored in IndexedDB)
- Camera-based QR scanning
- Manual search by name/email
- Visual feedback: green (valid), red (already checked in / invalid), yellow (special attention)
- Local queue of check-in events
- Auto-sync when online
- Battery-efficient (minimal background processing)

---

## 15. Dashboard — Single App, Context Switching

### One Dashboard, Multiple Views

> **Do NOT build separate frontend apps for Admin/Exhibitor/Sponsor.** Build one dashboard that switches context based on the authenticated user's roles and scopes.

### View Hierarchy

```
Dashboard (Next.js)
├── Platform Admin View
│   ├── All events overview
│   ├── System settings
│   ├── User/role management
│   ├── Platform-wide analytics
│   └── Audit logs
│
├── Event Admin View
│   ├── Event configuration
│   ├── Ticket types & pricing
│   ├── Form schema editor
│   ├── Attendee management
│   ├── Orders & invoicing
│   ├── Check-in dashboard (live)
│   ├── Communications (email/SMS)
│   ├── Badge template editor
│   ├── Analytics & KPIs
│   ├── Promo codes & discounts
│   ├── Capacity management
│   ├── Staff/volunteer management
│   └── Data exports
│
├── Organization View (Exhibitor / Sponsor / Partner)
│   ├── Organization profile
│   ├── Booth/stand details (exhibitor)
│   ├── Lead capture data
│   ├── Badge scanning history
│   ├── Branding assets (sponsor)
│   ├── Impression analytics (sponsor)
│   └── Invoices & billing
│
└── Attendee View (lightweight — may also be in Client)
    ├── My tickets
    ├── My schedule
    ├── My badge (download/wallet)
    ├── My profile
    └── My sessions
```

### UI Requirements

- **Cutting-edge modern UI** — clean, responsive, fast
- **Dark/light mode**
- **Context switching**: admin can switch between events, impersonate users for support
- **Real-time updates**: SSE-powered counters, live check-in feed
- **Mobile-responsive**: dashboard usable on tablets for on-site ops
- **Accessible**: WCAG 2.1 AA compliance

---

## 16. SRA Ecosystem Integration

### Entity Auto-Creation Flow

When an exhibitor/partner/sponsor registers in SRAtix but doesn't have an existing SRA MAP entity:

```
SRAtix Registration
  → Server checks wp_mappings for existing entity
  → No entity found
  → Server sends webhook to Control plugin:
    POST /wp-json/sratix-control/v1/create-entity
    {
      "type": "exhibitor",
      "name": "RoboTech AG",
      "address": "...",
      "contact_email": "...",
      "sratix_org_id": "uuid"
    }
  → Control plugin creates sra_entity CPT post
  → Control plugin responds with entity ID
  → Server stores mapping: sratix_org_id ↔ wp_entity_id
```

### Entity Marking

If an exhibitor/partner/sponsor **already has** an SRA MAP entity:
- SRAtix exposes their data through its API
- A visual mark/badge is added to their entity card on the map (e.g., "SRD 2026 Exhibitor")
- Implemented via Control plugin adding meta to the entity post, which SRA MAP's frontend reads

### Corporate Member Integration

`corporate-member` CPT = company profile pages managed by SRA's "legal" members.

Same pattern as map entities:
- If registrant is also an event exhibitor/partner/sponsor AND has a corporate-member profile → mark/link it
- If they don't have one yet → optionally auto-create via Control plugin
- Server stores the bidirectional mapping

### ProfileGrid Integration

- User group memberships, roles, and tiers synced from WP → Server via Control plugin
- Used for: auto-applying discounts (member pricing), pre-filling form fields, role assignment

---

## 17. Multi-Tenancy Design

### Scope

SRAtix is designed for **multiple events across potentially multiple organizations**, not just Swiss Robotics Day.

### Isolation Model

```
Platform Level
└── Organizations (SRA, partner orgs)
    └── Events (SRD 2026, SRD 2027, Workshop Series, etc.)
        └── All event-scoped data (tickets, attendees, orders, etc.)
```

### Implementation

- Every scoped query includes `event_id` and/or `org_id` filter
- **Middleware-enforced**: NestJS guards extract tenant context from JWT and inject into every service call
- **No cross-tenant data leakage**: queries physically cannot return data from other events/orgs
- **Shared infrastructure**: one database, one Server instance. Isolation is logical, not physical (cost-effective for SRA's scale)
- **Per-event configuration**: each event has independent settings for forms, ticket types, badge templates, email templates, pricing, capacity, etc.

---

## 18. GDPR / nLPD Compliance

### Built-In From Day 1 — Not Bolted On

| Requirement | Implementation |
|-------------|---------------|
| **Data minimization** | Form builder enforces "required justification" for each field (`requiredJustification` in schema) |
| **Consent management** | Granular consent flags per data use (marketing, profiling, app personalization) stored with timestamp in form submissions |
| **Lawful basis** | Each data collection point documents its legal basis (contract performance, legitimate interest, consent) |
| **Right to erasure** | Server API endpoint cascades deletion: attendee data + form submissions + Stripe customer deletion (via API) + badge renders (R2 cleanup) + notify Control/Client plugins |
| **Right to access** | API endpoint returns all data held about an individual in structured JSON |
| **Data portability** | JSON/CSV export endpoint for attendee's own data (machine-readable) |
| **Processing records** | Audit log table: who accessed what, when, from where, for what purpose |
| **Data residency** | PostgreSQL hosted in Switzerland or EU. Cloudflare configured to EU-only data centers (Enterprise) or accepted in processing agreement (Free/Pro) |
| **Retention policies** | Configurable per-event: auto-purge attendee PII X months after event. Financial records retained per Swiss law (10 years). Consent records retained as long as needed for proof. |
| **Breach notification** | Audit logging + anomaly detection hooks. nLPD requires notification to FDPIC "as soon as possible." Logging enables forensic timeline construction. |
| **DPA with processors** | Document Data Processing Agreements with: Stripe, email provider, Cloudflare, hosting provider |
| **Cookie consent** | Minimal cookies on Server dashboard (session only). Registration forms embedded in WP inherit WP's consent banner. |
| **Privacy by design** | IP addresses hashed. PII encryption at rest for sensitive fields (field-level encryption for key items). Minimal data in logs. |

### nLPD-Specific (Swiss Federal Act on Data Protection, effective Sep 2023)

- **Data Protection Advisor** designation required → document in Server settings
- **Processing directory** → Server auto-generates from its data model (what data, why, retention, processors)
- **Cross-border transfer** → Document if data leaves Switzerland (Stripe is US-based; covered by their Standard Contractual Clauses)
- **Privacy impact assessment** → Required for large-scale processing of sensitive data. Registration data may qualify — prepare template.

---

## 19. Security Baseline

### Non-Negotiable Security Measures

| Layer | Measure |
|-------|---------|
| **API** | Rate limiting per endpoint (Redis counters). Stricter limits on auth endpoints. |
| **API** | Input validation on every endpoint (NestJS Pipes + class-validator) |
| **API** | CORS whitelist: only `swiss-robotics.org`, `swissroboticsday.ch`, dashboard origin |
| **Auth** | Short-lived JWT (15 min). Refresh tokens (7 days, rotated on use). httpOnly cookies. |
| **Auth** | Account lockout after N failed attempts. Progressive delays. |
| **Payments** | Stripe webhook signature verification on every incoming webhook |
| **Payments** | Distributed locks (Redis) to prevent double-charge race conditions |
| **Data** | PII encryption at rest for highly sensitive fields (field-level, not just disk encryption) |
| **Data** | Database connection via TLS. No plaintext credentials in environment. |
| **Tenancy** | Strict tenant isolation: every query scoped by authenticated context |
| **Access** | RBAC + permission checks at API layer (NestJS Guards), never UI-only |
| **Audit** | Immutable audit log: user ID, action, target, timestamp, IP, user agent |
| **Infra** | Cloudflare WAF rules (free tier) for common attack patterns |
| **Infra** | Cloudflare Turnstile on registration forms (bot protection) |
| **Infra** | HTTPS everywhere. HSTS headers. |
| **Infra** | Security headers: CSP, X-Frame-Options, X-Content-Type-Options |
| **Ops** | Automated backups (PostgreSQL) with tested restore procedures |
| **Ops** | Health check endpoints for monitoring |
| **Ops** | Structured logging (Pino) — no PII in logs |
| **Webhooks** | HMAC signature verification on all incoming webhooks (Stripe, WP plugins) |
| **Webhooks** | Outgoing webhooks signed with per-destination secrets |

### Cloudflare is Edge Hardening, Not "Security"

Cloudflare provides valuable edge protection (DDoS, WAF, bot filtering) but is **not a substitute for application-level security**. Every measure above is implemented in the application itself.

---

## 20. Configuration Philosophy

### Capability Matrix — Not "Toggle Everything"

> **Risk**: "settings and toggles for everything" leads to bloated UI, edge case explosions, and analysis paralysis.

**Approach**: Prioritized configuration tiers.

#### Tier 1 — UI-Configurable From Day 1

These are the settings admins will change frequently:

- Ticket types, pricing, capacity limits, sales windows
- Form schemas (field definitions, sections, conditional logic)
- Email templates (subject, body, variables)
- Badge templates (background, dynamic element positions)
- Discount/promo code rules
- Refund policy rules
- Capacity rules (event-level, session-level)
- Event details (name, dates, venue, timezone)
- Check-in settings (allow re-entry, multi-scan handling)
- Communication scheduling
- Data export format preferences

#### Tier 2 — Admin Settings (Power Users)

- Stripe mode (test/live) per event
- Webhook endpoints and secrets
- RBAC role customization
- Retention policy durations
- Email transport configuration
- API rate limit thresholds
- Branding (logo, colors for dashboard/emails/badges)

#### Tier 3 — Environment/Code Level

Sensible defaults that rarely change. Promoted to UI only if proven necessary:

- Database connection parameters
- Redis configuration
- Session durations
- HMAC algorithms
- File storage paths
- Log levels
- Background job concurrency
- Health check intervals

---

## 21. Cloudflare Integration

### Free Tier Usage

| Feature | Use Case |
|---------|----------|
| **CDN** | Cache static assets (dashboard JS/CSS, badge templates, public event pages) |
| **DNS** | Manage `tix.swiss-robotics.org` subdomain |
| **SSL** | Free SSL certificate for subdomain |
| **WAF** | Basic attack protection (SQLi, XSS patterns) |
| **DDoS** | Automatic DDoS mitigation |
| **Turnstile** | Bot protection on registration forms (free, privacy-friendly) |
| **Caching Rules** | Cache public event info, invalidate on update |

### Cloudflare R2 (Storage — Pay-per-use, No Egress Fees)

- Badge PDFs
- Invoice PDFs
- Uploaded assets (attendee photos, sponsor logos, template backgrounds)
- Data export files (temporary, auto-expiring)

Avoids storing binary blobs in PostgreSQL. S3-compatible API.

### Cloudflare Workers (Free Tier — Optional Future)

- Edge-level caching for public event API responses
- Geographic routing for multi-region events (future)
- Edge validation for simple API requests

---

## 22. Future Event App Readiness

### API-First Design for App Consumption

All Server APIs designed as if a native app will consume them from day 1:

- **Clean JSON responses** — no HTML in API payloads, no server-rendered partials
- **Authentication via Bearer tokens** — same OAuth2-lite flow, adapted for mobile (PKCE flow for public clients)
- **Pagination** — cursor-based pagination on all list endpoints
- **Versioned API** — `/api/v1/...` prefix, backward-compatible changes within version
- **OpenAPI spec** — auto-generated from NestJS decorators, enables SDK generation for any client
- **Offline-first data model** — every record has `updated_at` timestamp for efficient delta sync
- **Push notification hooks** — Server can trigger push notifications via future integration (FCM/APNs)

### PWA-First, Native-Ready

- **PWA** for first events — shared web stack, no app store approval, instant updates
- **Architecture** decoupled enough that a React Native / Flutter app can consume the same APIs
- **WebSocket endpoints** ready for bi-directional needs (live polling, chat, interactive features)
- **Sync protocol** designed for offline-first (delta sync via `updated_at` + conflict resolution)

### Event App Data Points (From Registration)

The registration forms intentionally collect data that powers event app personalization:

- Research/industry interests → personalized session recommendations
- Networking preferences → smart matchmaking
- Dietary/accessibility → logistics personalization
- Company/role data → networking profiles
- Session registrations → personalized schedule
- Consent flags → control what's visible in app

---

## 23. Phased Build Plan

### Phase 1 — Core Ticketing MVP

**Goal**: End-to-end ticket purchase and issuance for one event.

- [ ] Event creation & configuration (CRUD)
- [ ] Ticket type definitions (pricing, capacity, sales windows)
- [ ] Registration form engine (JSON schema → rendered form → submission)
- [ ] Stripe Checkout integration (payment flow)
- [ ] Order management (create, confirm, cancel)
- [ ] Ticket issuance with QR code generation
- [ ] Email confirmations (MJML templates via SMTP)
- [ ] Basic attendee management (list, search, view, export)
- [ ] Basic invoice PDF generation
- [ ] Promo/discount codes (basic)
- [ ] Server dashboard MVP (Next.js — event config, attendee list, order list)
- [ ] REST API (core endpoints for Control + Client plugins)
- [ ] SRAtix Control plugin MVP (WP — token exchange, user sync, admin link)
- [ ] SRAtix Client plugin MVP (WP — form embedding, shortcodes)
- [ ] GDPR/nLPD compliance framework (consent, retention, erasure endpoint)
- [ ] Audit log (basic)
- [ ] Security baseline (auth, RBAC, rate limiting, input validation)
- [ ] Multi-tenancy scaffolding (event_id scoping everywhere)

### Phase 2 — Operations & Automation

**Goal**: Event-day operations and richer automation.

- [ ] Badge template system (Puppeteer rendering pipeline)
- [ ] Badge builder UI (visual editor)
- [ ] Check-in system (online — dashboard + scanner page)
- [ ] Staff/volunteer role management
- [ ] Webhook system (outgoing to WP plugins, incoming from Stripe)
- [ ] BullMQ job queue integration (email, PDF, badge workers)
- [ ] KPI dashboard (sales velocity, attendance, conversion, revenue)
- [ ] Communication tools (segmented sends, scheduled emails)
- [ ] Apple/Google Wallet pass generation
- [ ] Enhanced invoice system (Swiss QR-bill, credit notes, org billing)
- [ ] Immutable financial ledger (append-only)
- [ ] SRA MAP entity integration (auto-create, marking)
- [ ] Corporate-member CPT integration
- [ ] Session/track management
- [ ] Waitlist management
- [ ] Group registrations
- [ ] Coupon/discount codes (advanced rules)
- [ ] Capacity management (per-event, per-session)

### Phase 3 — Offline + Swicket-Class Features + Event App Sync

**Goal**: Full operational capability, offline support, and event app API readiness.

- [ ] Offline check-in system (check-in packs, signed QR, PWA scanner)
- [ ] Advanced billing modes (organization invoices, complex refund flows)
- [ ] Advanced communication (segmentation, scheduling, A/B)
- [ ] SMS integration (Twilio)
- [ ] Lead capture tooling (exhibitor badge scanning, data export)
- [ ] Deep analytics & metrics (engagement scoring, funnel analysis)
- [ ] Sponsor impression analytics
- [ ] On-site kiosk mode
- [ ] Badge printing integration (network printer support)
- [ ] A/B testing on registration forms
- [ ] Event app sync primitives (delta sync API, push notification hooks)
- [ ] OpenAPI spec generation + SDK tooling
- [ ] Data export enhancements (scheduled reports, custom queries)
- [ ] Advanced security (anomaly detection, breach notification workflow)

### Phase 4 — Event App

**Goal**: Separate project consuming SRAtix APIs.

- [ ] PWA event app (personalized schedule, networking, live updates)
- [ ] Offline-first data sync
- [ ] Push notifications (FCM/APNs)
- [ ] In-app badge display
- [ ] In-app lead exchange
- [ ] Live session features (polling, Q&A)
- [ ] Attendee-to-attendee messaging
- [ ] Sponsor/exhibitor discovery
- [ ] Post-event content access

---

## 24. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | **Scope creep** — Swicket has years of development | High | High | Strict MVP phasing. Launch with Phase 1 only. Resist feature additions until phase is complete. |
| 2 | **Hosting limitations** — Node.js hosting may restrict WebSockets, long-running processes, or Redis | Low | Medium | **TESTED 2026-02-17**: WebSockets, SSE, worker threads, child processes, outbound HTTPS, file I/O all confirmed working. Redis/PostgreSQL not yet configured — need to verify hosting DB availability. Chromium not pre-installed — use bundled Puppeteer or lighter alternative. |
| 3 | **Single point of failure** — Server down = both sites lose ticketing | Medium | High | PM2 auto-restart, health checks, Cloudflare caching for static assets, graceful degradation in WP plugins (show "temporarily unavailable" message). |
| 4 | **Data sync conflicts** — WP and Server disagree on user/entity state | Medium | Medium | Event-driven sync with idempotent operations. Server always authoritative for ticketing data. WP always authoritative for WP content. |
| 5 | **Stripe PCI compliance** — handling card data | Low | High | Stripe Checkout (hosted) = SAQ-A (minimal PCI scope). Never touch raw card numbers. |
| 6 | **Form builder complexity** — building a product within a product | Medium | Medium | Phase 1: JSON-defined forms. Visual builder deferred to Phase 2+. Schema format is stable; authoring UX evolves. |
| 7 | **Offline check-in edge cases** — network flapping, duplicate scans | Medium | Medium | Signed QR codes for offline validation. First-check-in-wins conflict resolution. Audit flags for conflicts. |
| 8 | **Too many configuration options** — settings UI becomes unusable | Medium | Medium | Capability matrix (§20). Three tiers. Promote to UI only when proven necessary. |
| 9 | **Multiple dashboards** — frontend maintenance burden | Low | Medium | One dashboard app with role-based context switching (§15). |
| 10 | **WordPress plugin scope creep** — plugins become thick | Medium | Medium | Control and Client plugins are connectors, not engines. All business logic in Server. If a feature "needs" WP code, it probably belongs in Server. |
| 11 | **Invoice/billing complexity** — numbering, VAT, credit notes, multi-currency | Medium | Medium | Start with single-currency (CHF). Append-only financial ledger from day 1. Expand billing features in Phase 2. |
| 12 | **Event app data model mismatch** — forms collect wrong data for future app | Low | High | Design form schemas with event app in mind from Phase 1. Document expected app data points. Schema versioning ensures backward compatibility. |

---

## 25. Hosting Capability Testing

### Purpose of Tester App

Before building the full Server, verify what the hosting platform actually supports. The Tester is a **minimal Node.js application** that probes server capabilities.

### Tests to Run

| # | Capability | Test Method | Fallback if Unsupported |
|---|-----------|-------------|------------------------|
| 1 | **Basic Node.js HTTP** | Simple Express/Fastify server responding to requests | — (if this fails, hosting is unsuitable) |
| 2 | **WebSocket upgrade** | Attempt `ws` WebSocket handshake | Use SSE exclusively (already preferred) |
| 3 | **Server-Sent Events** | SSE endpoint with keep-alive | Long-polling (worst case) |
| 4 | **Redis connection** | Connect to Redis (if provided) or external Redis | Use pgBoss (PostgreSQL-backed queues) instead of BullMQ |
| 5 | **PostgreSQL connection** | Connect to PostgreSQL with Prisma | — (if this fails, need different hosting) |
| 6 | **Long-running process** | Server stays alive after initial request | PM2 process manager, or hosting may kill idle processes |
| 7 | **Background workers** | Spawn child process or worker thread | In-process job handling (less ideal but functional) |
| 8 | **File system write** | Write temp files (badge PDFs, exports) | Write to Cloudflare R2 directly (stream) |
| 9 | **Puppeteer / Chromium** | Attempt headless Chrome launch for PDF generation | External PDF generation service, or pre-render on dev machine |
| 10 | **Outbound HTTPS** | Call external APIs (Stripe, SMTP, Cloudflare R2) | — (if blocked, hosting is unsuitable for this project) |
| 11 | **Environment variables** | Read from `process.env` | `.env` file loading via `dotenv` |
| 12 | **Process memory** | Check available memory (Puppeteer needs ~200MB+) | If constrained, use lighter PDF libraries |
| 13 | **Cron / scheduled tasks** | `node-cron` or hosting-provided scheduler | Manual triggers only |
| 14 | **Port binding** | Can the app bind to a custom port? Or must it use a specific one? | Adapt to hosting's port assignment |
| 15 | **HTTPS / TLS termination** | Does hosting handle SSL, or must the app? | Usually hosting/Cloudflare handles this |

### Tester Deliverable

The Tester generates a **capability report** summarizing what's supported, what's limited, and recommended fallbacks. This report drives final technology decisions before Phase 1 development begins.

---

## 26. Workspace Structure

```
SRAtix/
├── Docs/                          # All documentation (this file, ADRs, guides)
│   ├── PRODUCTION-ARCHITECTURE.md # This document
│   ├── ADR/                       # Architecture Decision Records (future)
│   └── API/                       # API documentation (future, auto-generated)
│
├── Tester/                        # Hosting capability test app
│   ├── package.json
│   ├── src/
│   │   └── index.ts               # Test runner
│   └── README.md
│
├── Server/                        # SRAtix Server (NestJS + Next.js)
│   ├── api/                       # NestJS API application
│   │   ├── src/
│   │   │   ├── modules/           # Feature modules (events, tickets, orders, etc.)
│   │   │   ├── common/            # Shared (guards, pipes, interceptors, decorators)
│   │   │   ├── config/            # Configuration management
│   │   │   └── main.ts            # Entry point
│   │   ├── prisma/
│   │   │   └── schema.prisma      # Database schema
│   │   └── package.json
│   ├── dashboard/                 # Next.js dashboard application
│   │   ├── src/
│   │   │   ├── app/               # Next.js App Router pages
│   │   │   ├── components/        # UI components
│   │   │   └── lib/               # Client-side utilities
│   │   └── package.json
│   ├── workers/                   # Background job processors
│   │   ├── email.worker.ts
│   │   ├── badge.worker.ts
│   │   ├── invoice.worker.ts
│   │   └── sync.worker.ts
│   └── README.md
│
├── Control/                       # SRAtix Control (WP Plugin for swiss-robotics.org)
│   ├── sratix-control.php         # Plugin bootstrap
│   ├── includes/
│   │   ├── class-sratix-control.php
│   │   ├── class-sratix-api-client.php
│   │   ├── class-sratix-webhook-handler.php
│   │   ├── class-sratix-user-sync.php
│   │   ├── class-sratix-entity-sync.php
│   │   └── class-sratix-token-exchange.php
│   ├── admin/
│   └── README.md
│
├── Client/                        # SRAtix Client (WP Plugin for swissroboticsday.ch)
│   ├── sratix-client.php          # Plugin bootstrap
│   ├── includes/
│   │   ├── class-sratix-client.php
│   │   ├── class-sratix-embed.php
│   │   ├── class-sratix-shortcodes.php
│   │   ├── class-sratix-webhook-handler.php
│   │   └── class-sratix-kiosk.php
│   ├── public/
│   └── README.md
│
└── .gitignore
```

---

## 27. Key Decisions Log

| # | Decision | Rationale | Date |
|---|----------|-----------|------|
| 1 | Node.js 24 for Server runtime | Real-time needs (SSE/WebSocket), event-driven architecture, ecosystem alignment with future event app, hosting support confirmed | 2026-02-17 |
| 2 | NestJS as Server framework (primary recommendation) | Structured, TypeScript-first, built-in guards/pipes/interceptors for RBAC and validation, modular architecture scales with feature count | 2026-02-17 |
| 3 | PostgreSQL as primary database | Relational integrity for financial data, JSONB for flexible form submissions, audit triggers, mature ecosystem | 2026-02-17 |
| 4 | SSE-first real-time strategy | Simpler than WebSockets, works through CDNs, sufficient for server→client push (dashboards, check-in). WebSockets reserved for bi-directional needs. | 2026-02-17 |
| 5 | Next.js for dashboard UI | SSR for public pages (SEO), SPA for admin dashboard, same Node/TS ecosystem, served from same subdomain | 2026-02-17 |
| 6 | Versioned form schemas with submission snapshots | GDPR compliance (prove consent context), data integrity across form changes, event app compatibility | 2026-02-17 |
| 7 | OAuth2-lite token exchange for WP↔Server auth | Clean upgrade path to OIDC, token scoping per-event/role, no long-lived browser tokens | 2026-02-17 |
| 8 | Stripe Checkout (hosted) for Phase 1 | Minimal PCI scope (SAQ-A), handles SCA/3DS, fastest to implement | 2026-02-17 |
| 9 | Append-only financial ledger | Dispute resolution, audit compliance, Swiss accounting requirements, independent of Stripe records | 2026-02-17 |
| 10 | Puppeteer for badge generation | Complex designs with images/colors/dynamic layout natural in HTML/CSS, same rendering for screen + print | 2026-02-17 |
| 11 | One dashboard with role-based context switching | Reduces frontend maintenance, consistent UX, single deployment | 2026-02-17 |
| 12 | Encrypted check-in packs + signed QR codes for offline validation | True offline QR validation via HMAC, scoped data download, encryption at rest on device | 2026-02-17 |
| 13 | Email/SMS transport abstraction from day 1 | SMTP initially, swap to SendGrid/Postmark/Twilio via config change, not refactor | 2026-02-17 |
| 14 | Cloudflare R2 for file storage | No egress fees, S3-compatible, avoids binary blobs in PostgreSQL | 2026-02-17 |
| 15 | Multi-tenancy from day 1 | event_id/org_id scoping on every table, middleware-enforced tenant isolation | 2026-02-17 |
| 16 | Capability matrix for configuration (3 tiers) | Prevents settings bloat, UI config for frequently changed items only, promotes from code to UI when proven necessary | 2026-02-17 |
| 17 | PWA-first for event app, API designed for native readiness | Shared web stack, no app store approval, clean JSON APIs enable React Native/Flutter later | 2026-02-17 |
| 18 | Control + Client plugins kept thin | Connectors only, all business logic in Server, prevents WordPress from becoming authoritative for ticketing data | 2026-02-17 |
| 19 | Hosting capabilities confirmed via Tester | Node v24.13.0, Linux x64, 64 CPUs, 257GB RAM, WebSockets + SSE both working, worker threads + child processes confirmed, outbound HTTPS + DNS clear, crypto (HMAC+AES) functional, process persistence verified. Chromium requires bundled Puppeteer install. | 2026-02-17 |
| 20 | MariaDB 10.6 instead of PostgreSQL | Hosting provides MariaDB only (shared hosting). Fully capable for SRAtix needs. Prisma supports via `mysql` provider. JSON columns + generated columns compensate for lack of JSONB. Upgrade path to PostgreSQL on Cloud Server exists. | 2026-02-17 |
| 21 | Upstash Redis (free tier) instead of local Redis | Redis not available on shared hosting. Upstash free tier (10k cmds/day, 256MB, EU region) sufficient for dev + early production. BullMQ compatible. Upgrade path to local Redis on Cloud Server. | 2026-02-17 |

---

## 28. Hosting Test Results (2026-02-17)

Tester deployed to `tix.swiss-robotics.org` via Git → Infomaniak Node.js hosting.

**Deployment method**: Git push to GitHub → change build command to `git pull origin main && npm install` → click Build → app auto-starts with `npm start`. No env-vars UI in hosting panel — using committed `.env` file with `dotenv` (private repo, temporary tester).

### Server Environment

| Property | Value |
|----------|-------|
| Node.js | v24.13.0 |
| Platform | Linux x64 |
| CPUs | 64 (shared hosting node) |
| Total Memory | 257,431 MB (~251 GB, shared) |
| Free Memory | 217,517 MB |
| Heap Used | 17 MB |
| Site path | `/sites/tix.swiss-robotics.org` |
| Process persistence | Minor heartbeat drift (101 beats / 104s) — not concerning |

### Capability Test Results — Final (15 Pass / 0 Fail / 2 Warn / 0 Skip)

| # | Test | Status | Details |
|---|------|--------|---------|
| 1 | Node.js Runtime | **PASS** | v24.13.0 — fully supported |
| 2 | Environment Variables | **PASS** | 32 env vars accessible |
| 3 | File System (R/W) | **PASS** | Temp dir + CWD both writable |
| 4 | Memory | **PASS** | 257GB total, 217GB free |
| 5 | Crypto (HMAC + AES) | **PASS** | HMAC-SHA256 + AES-256-GCM functional |
| 6 | Worker Threads | **PASS** | Executed computation in worker |
| 7 | Child Process | **PASS** | Spawned child Node process |
| 8 | Scheduling (setInterval) | **PASS** | 3 ticks in 301ms (expected ~300ms) |
| 9 | Native fetch() | **PASS** | HTTP 200, 558ms |
| 10 | Outbound HTTPS | **PASS** | All external endpoints reachable, 515ms |
| 11 | DNS Resolution | **PASS** | All targets resolved, 2ms |
| 12 | TLS / HTTPS | **PASS** | TLS module available, external termination expected |
| 13 | MariaDB | **PASS** | Connected — ks704_tix (MariaDB 10.6.20), 545ms |
| 14 | Redis (Upstash) | **PASS** | Connected — Redis 8.2.0, 650ms |
| 15 | Chromium / Puppeteer | **WARN** | Not pre-installed on server |
| 16 | Disk Space | **PASS** | Disk info retrieved |
| 17 | Process Persistence | **WARN** | Minor heartbeat drift (101/104s) — cosmetic |

### Client-Side Connection Tests (Browser → Server)

| Test | Status | Details |
|------|--------|---------|
| WebSocket Upgrade | **PASS** | Connection established, echo confirmed |
| Server-Sent Events | **PASS** | All 5 events received successfully |

### Implications for Architecture

1. **SSE + WebSocket both confirmed** — SSE-first strategy validated; WebSocket available for future event app
2. **Worker threads work** — can use for CPU-intensive tasks (badge rendering, data processing) within same process
3. **Child processes work** — Puppeteer can spawn headless Chromium as child process
4. **Chromium not pre-installed** — must install `puppeteer` (not `puppeteer-core`) to bundle its own Chromium binary, OR use lighter PDF alternatives (`pdf-lib`, `satori`). Given 257GB RAM and writable filesystem, bundled Puppeteer likely works.
5. **MariaDB 10.6 connectivity confirmed** — Connected to `ks704_tix` on `ks704.myd.infomaniak.com:3306`. Prisma mysql provider ready.
6. **Upstash Redis connectivity confirmed** — Redis 8.2.0 via TLS (`rediss://`), 650ms latency (EU region). BullMQ compatible.
7. **Process persistence confirmed** — minor heartbeat drift is cosmetic, not a reliability concern
8. **Outbound connectivity unrestricted** — Stripe, SMTP, Cloudflare R2, external APIs all reachable
9. **No env-vars panel** — Infomaniak Node.js hosting has no UI for environment variables. Production must use committed `.env` (private repo) or runtime config file loaded by `dotenv`.

### Outstanding Items

- [x] ~~Verify PostgreSQL availability~~ → Not available. Using MariaDB 10.6.
- [x] ~~Verify Redis availability~~ → Not available on shared hosting. Using Upstash Redis free tier.
- [x] ~~Create MariaDB database for SRAtix on hosting panel~~ → `ks704_tix` created
- [x] ~~Set up Upstash Redis account (free tier, EU region)~~ → `topical-kite-7164.upstash.io`
- [x] ~~Test MariaDB + Upstash Redis connectivity from Tester app~~ → Both PASS
- [ ] Test bundled Puppeteer Chromium launch on this hosting
- [ ] Confirm long-term process persistence (hours/days, not just minutes)
- [ ] Check if hosting auto-restarts crashed processes or if PM2 is needed

---

*This document is the canonical reference for SRAtix architecture. Update it as decisions evolve. All implementation should align with the principles and patterns documented here.*
