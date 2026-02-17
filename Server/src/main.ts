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
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

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

  // Global prefix — all API routes under /api
  app.setGlobalPrefix('api', {
    exclude: ['/health'],
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

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);

  await app.listen(port, '0.0.0.0');

  logger.log(`
╔══════════════════════════════════════════════╗
║           SRAtix Server v0.1.0               ║
╠══════════════════════════════════════════════╣
║  Port     : ${String(port).padEnd(33)}║
║  Node     : ${process.version.padEnd(33)}║
║  PID      : ${String(process.pid).padEnd(33)}║
║  Env      : ${(config.get('NODE_ENV') || 'development').padEnd(33)}║
╚══════════════════════════════════════════════╝`);
}

bootstrap();
