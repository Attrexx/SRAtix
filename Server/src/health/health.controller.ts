import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SkipRateLimit } from '../common/guards/rate-limit.guard';

@Controller('health')
@SkipRateLimit()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const dbOk = await this.prisma
      .$queryRawUnsafe('SELECT 1 as ok')
      .then(() => true)
      .catch(() => false);

    return {
      status: dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      node: process.version,
      uptime: Math.floor(process.uptime()),
      database: dbOk ? 'connected' : 'unreachable',
    };
  }
}
