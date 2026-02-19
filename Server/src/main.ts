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

      // SPA fallback: serve index.html for any unmatched GET request
      // (client-side routing handles /dashboard/events/[id]/... etc.)
      const indexHtml = readFileSync(join(dashboardDir, 'index.html'), 'utf-8');
      fastify.setNotFoundHandler((request, reply) => {
        // Only serve SPA fallback for navigation requests (not API or assets)
        if (
          request.method === 'GET' &&
          !request.url.startsWith('/api/') &&
          !request.url.startsWith('/health') &&
          !request.url.startsWith('/webhooks/')
        ) {
          reply.type('text/html').send(indexHtml);
        } else {
          reply.code(404).send({ statusCode: 404, message: 'Not Found' });
        }
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
