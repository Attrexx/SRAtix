// Load .env BEFORE anything else — Prisma reads DATABASE_URL from process.env
import { config } from 'dotenv';
import { join } from 'path';
const envResult = config({ path: join(__dirname, '..', '.env') }); // Server/.env (relative to dist/)
config(); // fallback: CWD/.env

console.log('[SRAtix] __dirname:', __dirname);
console.log('[SRAtix] .env path:', join(__dirname, '..', '.env'));
console.log('[SRAtix] dotenv loaded:', envResult.error ? 'FAILED: ' + envResult.error.message : 'OK');
console.log('[SRAtix] DATABASE_URL set:', !!process.env.DATABASE_URL);
console.log('[SRAtix] JWT_SECRET set:', !!process.env.JWT_SECRET);

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  try {
    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: true, trustProxy: true }),
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

    // Global prefix — all API routes under /api, health excluded
    app.setGlobalPrefix('api', {
      exclude: ['health'],
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

    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT', 3000);

    // Add a root route for basic info
    const fastify = app.getHttpAdapter().getInstance();
    fastify.get('/', async () => ({
      service: 'SRAtix Server',
      version: '0.1.0',
      status: 'running',
    }));

    await app.listen(port, '0.0.0.0');

    logger.log(`SRAtix Server v0.1.0 listening on port ${port}`);
    logger.log(`Node ${process.version}, PID ${process.pid}`);
  } catch (error) {
    console.error('[SRAtix] FATAL: Failed to start:', error);
    process.exit(1);
  }
}

bootstrap();
