import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SseModule } from '../sse/sse.module';
import { SystemController } from './system.controller';
import { DeployAuthGuard } from './guards/deploy-auth.guard';

@Module({
  imports: [
    SseModule,
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [SystemController],
  providers: [DeployAuthGuard],
})
export class SystemModule {}
