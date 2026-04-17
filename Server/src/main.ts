// Load .env BEFORE anything else — Prisma reads DATABASE_URL from process.env
import { config } from 'dotenv';
import { join, resolve } from 'path';
config({ path: join(__dirname, '..', '.env') }); // Server/.env (relative to dist/)
config(); // fallback: CWD/.env

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { AuditLogService, AuditAction } from './audit-log/audit-log.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  try {
    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({
        logger: true,
        trustProxy: true,
        ignoreTrailingSlash: true,  // Infomaniak proxy appends trailing slashes
      }),
      {
        rawBody: true, // Required for Stripe webhook signature verification
      },
    );

    // Cookie support — required for httpOnly refresh token storage
    const configService = app.get(ConfigService);
    await app.register(fastifyCookie as any, {
      secret: configService.get<string>('COOKIE_SECRET') || configService.getOrThrow<string>('JWT_SECRET'),
    });

    // Multipart file uploads (event logos, etc.)
    await app.register(fastifyMultipart as any, {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    });

    // Global validation pipe — DTOs auto-validated
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    // Global prefix — all API routes under /api, health + webhooks excluded
    app.setGlobalPrefix('api', {
      exclude: ['health', 'webhooks/stripe'],
    });

    // CORS — allow WP sites to call the API
    app.enableCors({
      origin: [
        'https://swiss-robotics.org',
        'https://www.swiss-robotics.org',
        'https://swissroboticsday.ch',
        'https://www.swissroboticsday.ch',
        'https://tix.swiss-robotics.org',
      ],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      credentials: true,
    });

    // Prevent Fastify from rejecting bodyless requests that carry Content-Type: application/json
    // (some proxies / browsers add this header even for DELETE with no body)
    const fastifyInstance = app.getHttpAdapter().getInstance();
    fastifyInstance.addHook('preParsing', (request, reply, payload, done) => {
      const cl = request.headers['content-length'];
      if (
        request.headers['content-type']?.startsWith('application/json') &&
        (!cl || cl === '0')
      ) {
        delete request.headers['content-type'];
      }
      done(null, payload);
    });

    // Disable Cloudflare response buffering for SSE streams
    fastifyInstance.addHook('onSend', async (request, reply, payload) => {
      if (reply.getHeader('content-type')?.toString().includes('text/event-stream')) {
        reply.header('X-Accel-Buffering', 'no');
      }
      return payload;
    });

    const port = configService.get<number>('PORT', 3000);

    // ── Uploads static serving ───────────────────────────────────
    // Serve uploaded files (event logos, etc.) from /uploads/
    const uploadsDir = resolve(__dirname, '..', 'uploads');
    const { mkdirSync } = await import('fs');
    mkdirSync(uploadsDir, { recursive: true });

    const fastify = app.getHttpAdapter().getInstance();
    await fastify.register(fastifyStatic, {
      root: uploadsDir,
      prefix: '/uploads/',
      decorateReply: false,
      setHeaders(res: any) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    });

    // ── Dashboard Static Files ───────────────────────────────────
    // Serve the Next.js static export (Dashboard/out/) directly from
    // Fastify. Single process, single port — no separate Next.js server.
    const dashboardDir = resolve(__dirname, '..', '..', 'Dashboard', 'out');

    if (existsSync(dashboardDir)) {
      // Serve static assets (_next/*, images, etc.)
      // HTML files get Cache-Control: no-cache so browsers always refetch the SPA shell after deploys.
      // Hashed JS/CSS assets from _next/ are immutably cached by the browser.
      await fastify.register(fastifyStatic, {
        root: dashboardDir,
        prefix: '/',
        decorateReply: false,
        wildcard: false,     // Don't intercept all routes — let NestJS handle /api/*
        setHeaders(res: any, filePath: string) {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
          } else if (filePath.includes('/_next/static/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      });

      // SPA fallback via onRequest hook (not setNotFoundHandler — NestJS
      // registers its own 404 handler and Fastify allows only one per prefix).
      // This hook intercepts Dashboard navigation requests BEFORE NestJS
      // routing, serving pre-rendered HTML directly. API routes, static
      // assets, and webhook paths pass through to NestJS / @fastify/static.
      const indexHtml = readFileSync(join(dashboardDir, 'index.html'), 'utf-8');
      fastify.addHook('onRequest', async (request, reply) => {
        const url = request.url.split('?')[0];

        // Skip: non-GET, API routes, health, webhooks
        if (
          request.method !== 'GET' ||
          url.startsWith('/api/') ||
          url.startsWith('/api') ||
          url.startsWith('/health') ||
          url.startsWith('/webhooks/')
        ) {
          return; // Let NestJS handle it
        }

        const urlPath = url.replace(/\/$/, '') || '/';

        // ── RSC payload rewriting for dynamic event routes ──────────
        // Next.js client-side navigation fetches .txt flight data
        // (e.g. /dashboard/events/{uuid}/index.txt?_rsc=...).
        // Only the '_' placeholder was pre-rendered, so rewrite any
        // real UUID path to serve from the '_' directory.
        const rscMatch = urlPath.match(
          /^\/dashboard\/events\/(?!_(?:\/|$))([^/]+)(\/.*\.txt)$/,
        );
        if (rscMatch) {
          const rscFile = join(
            dashboardDir, 'dashboard', 'events', '_',
            rscMatch[2].replace(/^\//, ''),
          );
          if (existsSync(rscFile)) {
            return reply
              .type('text/plain')
              .send(readFileSync(rscFile, 'utf-8'));
          }
        }

        // Skip files with extensions (.js, .css, .png, .json, .woff2, etc.)
        if (/\.\w{2,5}$/.test(url)) {
          return; // Let @fastify/static handle it
        }

        // Map /dashboard/events/<realId>/... → /dashboard/events/_/.../index.html
        const eventRouteMatch = urlPath.match(
          /^\/dashboard\/events\/[^/]+(\/.*)?$/,
        );
        if (eventRouteMatch) {
          const subpath = eventRouteMatch[1] || '';
          const placeholderHtml = join(
            dashboardDir, 'dashboard', 'events', '_',
            subpath.replace(/^\//, ''), 'index.html',
          );
          if (existsSync(placeholderHtml)) {
            return reply
              .header('Cache-Control', 'no-cache, no-store, must-revalidate')
              .type('text/html')
              .send(readFileSync(placeholderHtml, 'utf-8'));
          }
        }

        // Try exact path match (e.g. /dashboard/index.html, /login/index.html)
        const exactHtml = join(dashboardDir, urlPath, 'index.html');
        if (existsSync(exactHtml)) {
          return reply
            .header('Cache-Control', 'no-cache, no-store, must-revalidate')
            .type('text/html')
            .send(readFileSync(exactHtml, 'utf-8'));
        }

        // Root path → root index.html
        if (urlPath === '/' || urlPath === '') {
          return reply
            .header('Cache-Control', 'no-cache, no-store, must-revalidate')
            .type('text/html')
            .send(indexHtml);
        }

        // Any other /dashboard/* or /login* path → SPA fallback (serve root index.html)
        // This handles client-side routing for pages that aren't pre-rendered
        // with an exact index.html match (e.g. /dashboard/settings)
        if (urlPath.startsWith('/dashboard') || urlPath.startsWith('/login')) {
          return reply
            .header('Cache-Control', 'no-cache, no-store, must-revalidate')
            .type('text/html')
            .send(indexHtml);
        }

        // Unknown non-API path: let NestJS handle (will 404)
      });

      logger.log(`Dashboard served from ${dashboardDir}`);
    } else {
      logger.warn(`Dashboard build not found at ${dashboardDir} — UI unavailable`);
    }

    // Retry listen() — safety net in case pre-start.js didn't fully clear the port
    const MAX_RETRIES = 20;
    const RETRY_DELAY = 1000;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await app.listen(port, '0.0.0.0');
        break; // success
      } catch (err: any) {
        if (err.code === 'EADDRINUSE' && attempt < MAX_RETRIES) {
          logger.warn(
            `Port ${port} in use — retrying in ${RETRY_DELAY / 1000}s (attempt ${attempt}/${MAX_RETRIES})`,
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY));
        } else {
          throw err; // final attempt or different error
        }
      }
    }

    // Write PID file so pre-start.js can cleanly stop us on next deploy
    const pidFile = join(__dirname, '..', '.sratix.pid');
    try { writeFileSync(pidFile, String(process.pid)); } catch {}

    logger.log(`SRAtix Server v0.1.0 listening on port ${port}`);
    logger.log(`Node ${process.version}, PID ${process.pid}`);

    // ── App Lifecycle Audit ────────────────────────────────────
    const audit = app.get(AuditLogService);

    audit.log({
      action: AuditAction.APP_STARTED,
      entity: 'app',
      detail: { version: '0.1.0', node: process.version, pid: process.pid, port },
    });

    // Graceful shutdown logging
    app.enableShutdownHooks();
    const shutdownHandler = async () => {
      // Hard deadline: force-exit after 10s to release the port even if
      // Prisma disconnect or audit log write hangs
      const killTimer = setTimeout(() => {
        console.error('[SRAtix] Shutdown timeout (10s) — force exit');
        process.exit(1);
      }, 10_000);
      killTimer.unref();

      // Clean up PID file (best-effort)
      try { unlinkSync(pidFile); } catch {}

      await audit.log({
        action: AuditAction.APP_SHUTDOWN,
        entity: 'app',
        detail: { pid: process.pid, uptime: Math.round(process.uptime()) },
      });
    };
    process.on('SIGTERM', shutdownHandler);
    process.on('SIGINT', shutdownHandler);

    // Crash logging (best-effort — DB may be unavailable)
    const crashHandler = async (err: Error) => {
      try {
        await audit.log({
          action: AuditAction.APP_CRASHED,
          entity: 'app',
          detail: { error: err.message, stack: err.stack?.slice(0, 2000), pid: process.pid },
        });
      } catch { /* DB may already be gone */ }
    };
    process.on('uncaughtException', async (err) => {
      logger.error('Uncaught exception', err);
      await crashHandler(err);
      process.exit(1);
    });
    process.on('unhandledRejection', async (reason) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      logger.error('Unhandled rejection', err);
      await crashHandler(err);
      process.exit(1);
    });
  } catch (error) {
    console.error('[SRAtix] FATAL: Failed to start:', error);
    process.exit(1);
  }
}

bootstrap();
