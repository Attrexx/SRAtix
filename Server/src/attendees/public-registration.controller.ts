import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AttendeesService } from './attendees.service';
import { FormsService } from '../forms/forms.service';
import { EmailService } from '../email/email.service';
import { AuthService } from '../auth/auth.service';

// ─── DTO ──────────────────────────────────────────────────────────────────

class RegistrationDto {
  @IsObject()
  @IsOptional()
  formData?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  password?: string;
}

// ─── Controller ───────────────────────────────────────────────────────────

/**
 * Public Registration Controller — unauthenticated.
 *
 * Handles token-based registration for ticket recipients. When a purchaser
 * buys tickets for others, each recipient gets a unique registration token
 * emailed to them. They visit this endpoint to complete their registration
 * form (the same form assigned to their ticket type).
 *
 * Routes:
 *   GET  /api/public/register/:token — returns form schema + pre-filled data
 *   POST /api/public/register/:token — completes registration, sends emails
 *
 * Works identically in test mode and live mode (no Stripe dependency).
 */
@Controller('public/register')
export class PublicRegistrationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attendees: AttendeesService,
    private readonly forms: FormsService,
    private readonly email: EmailService,
    private readonly auth: AuthService,
  ) {}

  /**
   * GET /api/public/register/:token
   *
   * Validate the registration token and return the form schema
   * with pre-filled attendee data for the registration page.
   */
  @Get(':token')
  async getRegistrationInfo(@Param('token') token: string) {
    if (!token || token.length !== 64) {
      throw new BadRequestException('Invalid registration token');
    }

    const attendee = await this.attendees.findByRegistrationToken(token);
    if (!attendee) {
      // Token was cleared by old code or is truly invalid — can't
      // distinguish, so return a friendly "likely already registered" hint.
      return { tokenConsumed: true };
    }

    // Find the ticket to get ticket type + form schema
    const ticket = await this.prisma.ticket.findFirst({
      where: { attendeeId: attendee.id, status: 'valid' },
      include: {
        ticketType: { select: { id: true, name: true, formSchemaId: true } },
        event: { select: { id: true, name: true, startDate: true, endDate: true, venue: true, venueAddress: true, meta: true } },
      },
    });

    // Load form schema if the ticket type has one, with event-level fallback
    let formSchema = null;
    let resolvedFormSchemaId: string | null = ticket?.ticketType?.formSchemaId ?? null;
    if (resolvedFormSchemaId) {
      formSchema = await this.forms.findSchemaForTicketType(
        attendee.eventId,
        ticket!.ticketType.id,
      );
    }
    // Fallback: if ticket type has no schema (e.g. Complimentary), try event's other ticket types
    if (!formSchema) {
      formSchema = await this.forms.findFallbackSchemaForEvent(attendee.eventId);
      if (formSchema) resolvedFormSchemaId = formSchema.id;
    }

    // Load saved form answers for re-visit pre-population
    let savedFormData = null;
    if (resolvedFormSchemaId) {
      const submission = await this.forms.findLatestSubmission(
        attendee.id,
        resolvedFormSchemaId,
      );
      if (submission) {
        savedFormData = submission.data;
      }
    }

    // Already registered — return full payload so form can be shown pre-filled
    const isAlreadyRegistered = attendee.status === 'registered';

    return {
      ...(isAlreadyRegistered ? { alreadyRegistered: true } : {}),
      attendee: {
        firstName: attendee.firstName,
        lastName: attendee.lastName,
        email: attendee.email,
        phone: attendee.phone ?? '',
        company: attendee.company ?? '',
      },
      event: ticket?.event ? {
        name: ticket.event.name,
        startDate: ticket.event.startDate,
        venue: ticket.event.venue,
      } : null,
      ticketTypeName: ticket?.ticketType?.name ?? null,
      formSchema,
      savedFormData,
    };
  }

  /**
   * POST /api/public/register/:token
   *
   * Validate the token, save form answers, mark attendee as registered,
   * and send confirmation emails (to recipient + purchaser).
   */
  @Post(':token')
  async completeRegistration(
    @Param('token') token: string,
    @Body() dto: RegistrationDto,
  ) {
    if (!token || token.length !== 64) {
      throw new BadRequestException('Invalid registration token');
    }

    const attendee = await this.attendees.findByRegistrationToken(token);
    if (!attendee) {
      return { tokenConsumed: true };
    }

    const isUpdate = attendee.status === 'registered';

    // Find the ticket for context
    const ticket = await this.prisma.ticket.findFirst({
      where: { attendeeId: attendee.id, status: 'valid' },
      include: {
        ticketType: { select: { id: true, name: true, formSchemaId: true } },
        event: { select: { id: true, name: true, startDate: true, endDate: true, venue: true, venueAddress: true, meta: true } },
        order: { select: { orderNumber: true } },
      },
    });

    // Save or update form submission if custom form data provided
    let resolvedSchemaId = ticket?.ticketType?.formSchemaId ?? null;
    if (!resolvedSchemaId && dto.formData && Object.keys(dto.formData).length > 0) {
      // Fallback: find schema from event's other ticket types
      const fallback = await this.forms.findFallbackSchemaForEvent(attendee.eventId);
      if (fallback) resolvedSchemaId = fallback.id;
    }
    if (resolvedSchemaId && dto.formData && Object.keys(dto.formData).length > 0) {
      await this.forms.upsertSubmission({
        eventId: attendee.eventId,
        attendeeId: attendee.id,
        formSchemaId: resolvedSchemaId,
        answers: dto.formData,
      });
    }

    // Update attendee with optional fields
    const updateData: Record<string, string> = {};
    if (dto.phone) updateData.phone = dto.phone;
    if (dto.company) updateData.company = dto.company;
    if (dto.firstName) updateData.firstName = dto.firstName;
    if (dto.lastName) updateData.lastName = dto.lastName;
    if (Object.keys(updateData).length > 0) {
      await this.attendees.update(attendee.id, updateData);
    }

    // Create or update User account with password if provided
    if (dto.password) {
      const passwordHash = await this.auth.hashPassword(dto.password);
      const email = attendee.email.toLowerCase();
      const existingUser = await this.prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        await this.prisma.user.update({
          where: { id: existingUser.id },
          data: { passwordHash },
        });
      } else {
        await this.prisma.user.create({
          data: {
            email,
            displayName: `${dto.firstName ?? attendee.firstName} ${dto.lastName ?? attendee.lastName}`.trim(),
            passwordHash,
          },
        });
      }
    }

    // Use updated names for emails and response
    const finalFirstName = dto.firstName ?? attendee.firstName;
    const finalLastName = dto.lastName ?? attendee.lastName;

    // Only run first-time registration logic (mark registered, send emails)
    if (!isUpdate) {
      // Mark registered (direct Prisma — status isn't in update() interface)
      await this.prisma.attendee.update({
        where: { id: attendee.id },
        data: { status: 'registered' },
      });

      // Send confirmation email to recipient
      if (ticket?.event) {
        const ticketMeta = ticket.meta as Record<string, unknown> | null;
        const isComp = ticketMeta?.isComp === true;

        if (isComp) {
          const compType = (ticketMeta?.compType as string) || 'staff';
          const compTypeLabels: Record<string, string> = {
            staff: 'Staff',
            volunteer: 'Volunteer',
            partner: 'Partner',
            sponsor_no_booth: 'Sponsor',
            sponsor_with_booth: 'Sponsor (Booth)',
          };
          const attendeeMeta = attendee.meta as Record<string, unknown> | null;
          const regEventMeta = (ticket.event.meta as Record<string, any>) ?? {};
          const regFullVenue = [ticket.event.venue, ticket.event.venueAddress].filter(Boolean).join(', ');

          this.email
            .sendCompEntryConfirmation(attendee.email, {
              recipientName: finalFirstName,
              compType,
              compTypeLabel: compTypeLabels[compType] || compType,
              organization: (attendeeMeta?.organization as string) || attendee.company || undefined,
              eventName: ticket.event.name,
              eventDate: ticket.event.startDate.toLocaleDateString('en-CH', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              }),
              eventVenue: regFullVenue,
              eventVenueMapUrl: regEventMeta.venueMapUrl || undefined,
              ticketCode: ticket.code,
              orderNumber: ticket.order?.orderNumber ?? '',
            })
            .catch((err) => console.error('[Registration] Comp confirmation email failed:', err));
        } else {
          const regEventMeta2 = (ticket.event.meta as Record<string, any>) ?? {};
          this.email
            .sendRecipientRegistrationConfirmation(attendee.email, {
              recipientName: finalFirstName,
              eventName: ticket.event.name,
              eventDate: ticket.event.startDate.toISOString().split('T')[0],
              eventVenue: [ticket.event.venue, ticket.event.venueAddress].filter(Boolean).join(', '),
              eventVenueMapUrl: regEventMeta2.venueMapUrl || undefined,
              ticketTypeName: ticket.ticketType?.name ?? 'Ticket',
            })
            .catch((err) => console.error('[Registration] Confirmation email failed:', err));
        }
      }

      // Notify the purchaser that the recipient registered
      if (attendee.purchasedByAttendeeId) {
        const purchaser = await this.prisma.attendee.findUnique({
          where: { id: attendee.purchasedByAttendeeId },
        });
        if (purchaser) {
          this.email
            .sendRecipientRegisteredNotification(purchaser.email, {
              purchaserName: purchaser.firstName,
              recipientName: `${finalFirstName} ${finalLastName}`,
              recipientEmail: attendee.email,
              eventName: ticket?.event?.name ?? 'Event',
            })
            .catch((err) => console.error('[Registration] Purchaser notification failed:', err));
        }
      }
    }

    return {
      success: true,
      message: isUpdate ? 'Details updated successfully' : 'Registration completed successfully',
      isUpdate,
      attendee: {
        firstName: finalFirstName,
        lastName: finalLastName,
        email: attendee.email,
      },
    };
  }
}
