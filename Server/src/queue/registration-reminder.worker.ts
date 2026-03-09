import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { QueueService } from './queue.service';

/**
 * Registration Reminder Worker — processes delayed reminder jobs.
 *
 * Registered on the 'reminder' queue. When a ticket recipient hasn't
 * completed their registration, sends reminder emails at 7 and 30 days.
 *
 * Each job checks the attendee's current status before sending — if
 * they've already registered, the reminder is silently skipped.
 *
 * Works identically in test and live modes.
 */
@Injectable()
export class RegistrationReminderWorker implements OnModuleInit {
  private readonly logger = new Logger(RegistrationReminderWorker.name);

  constructor(
    private readonly queue: QueueService,
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async onModuleInit() {
    if (!this.queue.isAvailable()) {
      this.logger.debug('Queue not available — reminder worker not started');
      return;
    }

    await this.queue.registerWorker(
      'reminder',
      async (job) => {
        if (job.name === 'reminder.registration') {
          await this.processRegistrationReminder(
            job.data as {
              attendeeId: string;
              eventId: string;
              isSecondReminder: boolean;
            },
          );
        } else {
          this.logger.warn(`Unknown reminder job: ${job.name}`);
        }
      },
      1, // low concurrency — reminders aren't time-critical
    );
  }

  /**
   * Schedule 7-day and 30-day registration reminders for a recipient attendee.
   * Jobs are deduplicated by attendee ID — re-scheduling overwrites previous jobs.
   */
  async scheduleReminders(attendeeId: string, eventId: string) {
    if (!this.queue.isAvailable()) {
      this.logger.debug(`Queue not available — skipping reminder scheduling for ${attendeeId}`);
      return;
    }

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    await this.queue.addJob(
      'reminder.registration',
      { attendeeId, eventId, isSecondReminder: false },
      { delay: SEVEN_DAYS_MS, jobId: `reminder-7d-${attendeeId}` },
    );

    await this.queue.addJob(
      'reminder.registration',
      { attendeeId, eventId, isSecondReminder: true },
      { delay: THIRTY_DAYS_MS, jobId: `reminder-30d-${attendeeId}` },
    );

    this.logger.log(`Scheduled 7-day and 30-day reminders for attendee ${attendeeId}`);
  }

  private async processRegistrationReminder(data: {
    attendeeId: string;
    eventId: string;
    isSecondReminder: boolean;
  }) {
    const attendee = await this.prisma.attendee.findUnique({
      where: { id: data.attendeeId },
    });

    if (!attendee || attendee.status !== 'invited') {
      this.logger.debug(
        `Skipping reminder for ${data.attendeeId} — status: ${attendee?.status ?? 'not found'}`,
      );
      return;
    }

    if (!attendee.registrationToken) {
      this.logger.debug(`Skipping reminder for ${data.attendeeId} — no token`);
      return;
    }

    if (attendee.registrationTokenExpiresAt && attendee.registrationTokenExpiresAt < new Date()) {
      this.logger.debug(`Skipping reminder for ${data.attendeeId} — token expired`);
      return;
    }

    // Find ticket + event for context
    const ticket = await this.prisma.ticket.findFirst({
      where: { attendeeId: attendee.id, status: 'valid' },
      include: {
        event: { select: { name: true, startDate: true } },
      },
    });

    // Find purchaser name
    const purchaser = attendee.purchasedByAttendeeId
      ? await this.prisma.attendee.findUnique({
          where: { id: attendee.purchasedByAttendeeId },
          select: { firstName: true, lastName: true },
        })
      : null;

    // Find registration base URL from order meta
    const order = await this.prisma.order.findFirst({
      where: {
        eventId: data.eventId,
        attendeeId: attendee.purchasedByAttendeeId ?? undefined,
        status: 'paid',
      },
      orderBy: { createdAt: 'desc' },
    });
    const orderMeta = (order?.meta as Record<string, unknown>) ?? {};
    const registrationBaseUrl = (orderMeta.registrationBaseUrl as string) ?? '';

    if (!registrationBaseUrl) {
      this.logger.warn(
        `No registration base URL for attendee ${data.attendeeId} — skipping reminder`,
      );
      return;
    }

    await this.email.sendRegistrationReminder(attendee.email, {
      recipientName: attendee.firstName,
      purchaserName: purchaser
        ? `${purchaser.firstName} ${purchaser.lastName}`
        : 'Someone',
      eventName: ticket?.event?.name ?? 'Event',
      eventDate: ticket?.event?.startDate?.toISOString().split('T')[0] ?? '',
      registrationUrl: `${registrationBaseUrl}?token=${attendee.registrationToken}`,
      isSecondReminder: data.isSecondReminder,
    });

    this.logger.log(
      `Sent ${data.isSecondReminder ? '30-day' : '7-day'} reminder to ${attendee.email}`,
    );
  }
}
