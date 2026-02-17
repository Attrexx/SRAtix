import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Prisma 7 library engine reads DATABASE_URL from environment
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to MariaDB');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Disconnected from MariaDB');
  }
}
