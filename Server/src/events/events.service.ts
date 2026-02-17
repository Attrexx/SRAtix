import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(orgId: string) {
    return this.prisma.event.findMany({
      where: { orgId },
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(id: string, orgId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, orgId },
    });
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  async create(data: {
    name: string;
    slug: string;
    orgId: string;
    startDate: Date;
    endDate: Date;
    timezone: string;
    venue?: string;
    description?: string;
    currency: string;
  }) {
    return this.prisma.event.create({ data });
  }

  async update(
    id: string,
    orgId: string,
    data: Partial<{
      name: string;
      slug: string;
      startDate: Date;
      endDate: Date;
      venue: string;
      description: string;
      status: string;
    }>,
  ) {
    await this.findOne(id, orgId); // Ensure it exists
    return this.prisma.event.update({ where: { id }, data });
  }
}
