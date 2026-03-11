import { Module } from '@nestjs/common';
import { SseController } from './sse.controller';
import { SseSystemController } from './sse-system.controller';
import { SseService } from './sse.service';

@Module({
  controllers: [SseController, SseSystemController],
  providers: [SseService],
  exports: [SseService],
})
export class SseModule {}
