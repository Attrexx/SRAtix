import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttendeesService {
  private readonly logger = new Logger(AttendeesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByEvent(eventId: string) {
    return this.prisma.attendee.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const attendee = await this.prisma.attendee.findUnique({
      where: { id },
    });
    if (!attendee) throw new NotFoundException(`Attendee ${id} not found`);
    return attendee;
  }

  async findByEmail(eventId: string, email: string) {
    return this.prisma.attendee.findFirst({
      where: { eventId, email },
    });
  }

  async create(data: {
    eventId: string;
    orgId: string;
    email: string;
    firstName: string;
    lastName: string;
    wpUserId?: number;
    meta?: Record<string, unknown>;
  }) {
    return this.prisma.attendee.create({
      data: {
        eventId: data.eventId,
        orgId: data.orgId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        wpUserId: data.wpUserId,
        meta: data.meta ? JSON.stringify(data.meta) : undefined,
      },
    });
  }

  async update(id: string, data: Partial<{
    firstName: string;
    lastName: string;
    meta: Record<string, unknown>;
  }>) {
    await this.findOne(id);
    return this.prisma.attendee.update({
      where: { id },
      data: {
        ...data,
        meta: data.meta ? JSON.stringify(data.meta) : undefined,
      },
    });
  }
}
