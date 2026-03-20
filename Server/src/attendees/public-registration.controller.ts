import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  BadRequestException,
  NotFoundException,
  GoneException,
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
    if (!attendee) throw new NotFoundException('Invalid registration link');

    // Check token expiry
    if (attendee.registrationTokenExpiresAt && attendee.registrationTokenExpiresAt < new Date()) {
      throw new GoneException('This registration link has expired');
    }

    // Check if already registered
    if (attendee.status === 'registered') {
      throw new BadRequestException('You have already completed registration');
    }

    // Find the ticket to get ticket type + form schema
    const ticket = await this.prisma.ticket.findFirst({
      where: { attendeeId: attendee.id, status: 'valid' },
      include: {
        ticketType: { select: { id: true, name: true, formSchemaId: true } },
        event: { select: { id: true, name: true, startDate: true, endDate: true, venue: true } },
      },
    });

    // Load form schema if the ticket type has one
    let formSchema = null;
    if (ticket?.ticketType?.formSchemaId) {
      formSchema = await this.forms.findSchemaForTicketType(
        attendee.eventId,
        ticket.ticketType.id,
      );
    }

    return {
      attendee: {
        firstName: attendee.firstName,
        lastName: attendee.lastName,
        email: attendee.email,
      },
      event: ticket?.event ? {
        name: ticket.event.name,
        startDate: ticket.event.startDate,
        venue: ticket.event.venue,
      } : null,
      ticketTypeName: ticket?.ticketType?.name ?? null,
      formSchema,
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
    if (!attendee) throw new NotFoundException('Invalid registration link');

    if (attendee.registrationTokenExpiresAt && attendee.registrationTokenExpiresAt < new Date()) {
      throw new GoneException('This registration link has expired');
    }

    if (attendee.status === 'registered') {
      throw new BadRequestException('You have already completed registration');
    }

    // Find the ticket for context
    const ticket = await this.prisma.ticket.findFirst({
      where: { attendeeId: attendee.id, status: 'valid' },
      include: {
        ticketType: { select: { id: true, name: true, formSchemaId: true } },
        event: { select: { id: true, name: true, startDate: true, endDate: true, venue: true } },
      },
    });

    // Save form submission if custom form data provided
    if (ticket?.ticketType?.formSchemaId && dto.formData && Object.keys(dto.formData).length > 0) {
      await this.forms.createSubmission({
        eventId: attendee.eventId,
        attendeeId: attendee.id,
        formSchemaId: ticket.ticketType.formSchemaId,
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

    // Mark registered and clear token (direct Prisma — status isn't in update() interface)
    await this.prisma.attendee.update({
      where: { id: attendee.id },
      data: {
        status: 'registered',
        registrationToken: null,
        registrationTokenExpiresAt: null,
      },
    });

    // Use updated names for emails and response
    const finalFirstName = dto.firstName ?? attendee.firstName;
    const finalLastName = dto.lastName ?? attendee.lastName;

    // Send confirmation email to recipient
    if (ticket?.event) {
      this.email
        .sendRecipientRegistrationConfirmation(attendee.email, {
          recipientName: finalFirstName,
          eventName: ticket.event.name,
          eventDate: ticket.event.startDate.toISOString().split('T')[0],
          eventVenue: ticket.event.venue ?? '',
          ticketTypeName: ticket.ticketType?.name ?? 'Ticket',
        })
        .catch((err) => console.error('[Registration] Confirmation email failed:', err));
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

    return {
      success: true,
      message: 'Registration completed successfully',
      attendee: {
        firstName: finalFirstName,
        lastName: finalLastName,
        email: attendee.email,
      },
    };
  }
}
