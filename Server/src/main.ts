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
import { Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'fs';

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
      ],
      credentials: true,
    });

    // Global rate limiting — 100 req/min per IP (overridable per-route with @RateLimit)
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new RateLimitGuard(reflector));

    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT', 3000);

    // ── Dashboard Static Files ───────────────────────────────────
    // Serve the Next.js static export (Dashboard/out/) directly from
    // Fastify. Single process, single port — no separate Next.js server.
    const dashboardDir = resolve(__dirname, '..', '..', 'Dashboard', 'out');
    const fastify = app.getHttpAdapter().getInstance();

    if (existsSync(dashboardDir)) {
      // Serve static assets (_next/*, images, etc.)
      await fastify.register(fastifyStatic, {
        root: dashboardDir,
        prefix: '/',
        decorateReply: false,
        wildcard: false,     // Don't intercept all routes — let NestJS handle /api/*
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
              .type('text/html')
              .send(readFileSync(placeholderHtml, 'utf-8'));
          }
        }

        // Try exact path match (e.g. /dashboard/index.html, /login/index.html)
        const exactHtml = join(dashboardDir, urlPath, 'index.html');
        if (existsSync(exactHtml)) {
          return reply
            .type('text/html')
            .send(readFileSync(exactHtml, 'utf-8'));
        }

        // Root path → root index.html
        if (urlPath === '/' || urlPath === '') {
          return reply.type('text/html').send(indexHtml);
        }

        // Any other /dashboard/* or /login* path → SPA fallback (serve root index.html)
        // This handles client-side routing for pages that aren't pre-rendered
        // with an exact index.html match (e.g. /dashboard/settings)
        if (urlPath.startsWith('/dashboard') || urlPath.startsWith('/login')) {
          return reply.type('text/html').send(indexHtml);
        }

        // Unknown non-API path: let NestJS handle (will 404)
      });

      logger.log(`Dashboard served from ${dashboardDir}`);
    } else {
      logger.warn(`Dashboard build not found at ${dashboardDir} — UI unavailable`);
    }

    await app.listen(port, '0.0.0.0');

    logger.log(`SRAtix Server v0.1.0 listening on port ${port}`);
    logger.log(`Node ${process.version}, PID ${process.pid}`);
  } catch (error) {
    console.error('[SRAtix] FATAL: Failed to start:', error);
    process.exit(1);
  }
}

bootstrap();
