import { Module, Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';

// Temporary inline controller — no dependencies, pure routing test
@Controller('health')
class HealthCheckController {
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      node: process.version,
      uptime: Math.floor(process.uptime()),
      env: {
        DATABASE_URL: !!process.env.DATABASE_URL,
        JWT_SECRET: !!process.env.JWT_SECRET,
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
      },
    };
  }
}

@Controller('api/ping')
class PingController {
  @Get()
  ping() {
    return { pong: true, ts: Date.now() };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(__dirname, '..', '.env'),
        '.env',
      ],
    }),
  ],
  controllers: [HealthCheckController, PingController],
})
export class AppModule {}
