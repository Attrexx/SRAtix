// Load .env BEFORE anything else — Prisma reads DATABASE_URL from process.env
import { config } from 'dotenv';
import { join } from 'path';
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
import proxy from '@fastify/http-proxy';

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

    // ── Dashboard Reverse Proxy ──────────────────────────────────
    // Proxy all non-API routes to the Next.js Dashboard running
    // on an internal port. Fastify gives priority to specific routes
    // (NestJS: /api/*, /health, /webhooks/*) over the wildcard proxy.
    const dashboardPort = configService.get<number>('DASHBOARD_PORT', 3100);
    const fastify = app.getHttpAdapter().getInstance();
    await fastify.register(proxy, {
      upstream: `http://127.0.0.1:${dashboardPort}`,
      prefix: '/',
      rewritePrefix: '/',
      http2: false,
      websocket: false,
    });
    logger.log(`Dashboard proxy → http://127.0.0.1:${dashboardPort}`);

    await app.listen(port, '0.0.0.0');

    logger.log(`SRAtix Server v0.1.0 listening on port ${port}`);
    logger.log(`Node ${process.version}, PID ${process.pid}`);
  } catch (error) {
    console.error('[SRAtix] FATAL: Failed to start:', error);
    process.exit(1);
  }
}

bootstrap();
