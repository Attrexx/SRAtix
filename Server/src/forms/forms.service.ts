import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Supported form field types per PRODUCTION-ARCHITECTURE.md §8.
 */
export type FieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'select'
  | 'multi-select'
  | 'checkbox'
  | 'radio'
  | 'textarea'
  | 'date'
  | 'file'
  | 'number'
  | 'country'
  | 'canton'
  | 'consent'
  | 'group';

/**
 * A single form field definition (JSON schema element).
 */
export interface FormField {
  id: string;
  type: FieldType;
  label: Record<string, string>; // i18n: { en, de, fr }
  required?: boolean;
  validation?: Record<string, unknown>;
  requiredJustification?: string; // GDPR: why is this field required?
  section?: string;
  order?: number;
  options?: Array<{
    value: string;
    label: Record<string, string>;
  }>;
  conditions?: Array<{
    field: string;
    operator: string;
    value: unknown;
  }>;
  placeholder?: Record<string, string>;
  helpText?: Record<string, string>;
}

export interface FormSection {
  id: string;
  label: Record<string, string>;
  order: number;
}

export interface FormSchemaDefinition {
  fields: FormField[];
  sections?: FormSection[];
  ticketTypeFieldMappings?: Record<string, string[]>;
}

/**
 * Forms Service — manages registration form schemas and submissions.
 *
 * Forms use a versioned JSON schema architecture:
 *   - Each schema is immutable once submissions exist
 *   - New versions can be created (schema_name + version key)
 *   - Submissions are always tied to a specific schema version
 *   - This provides GDPR auditability (prove what user saw at submission time)
 */
@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Schema CRUD ──────────────────────────────────────────────

  /**
   * List all form schemas for an event.
   */
  async findSchemasByEvent(eventId: string) {
    return this.prisma.formSchema.findMany({
      where: { eventId },
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
    });
  }

  /**
   * Get a specific form schema by ID.
   */
  async findSchema(id: string, eventId: string) {
    const schema = await this.prisma.formSchema.findFirst({
      where: { id, eventId },
    });
    if (!schema) throw new NotFoundException(`Form schema ${id} not found`);
    return schema;
  }

  /**
   * Get the latest active version of a named schema for an event.
   */
  async findLatestActiveSchema(eventId: string, name: string) {
    const schema = await this.prisma.formSchema.findFirst({
      where: { eventId, name, active: true },
      orderBy: { version: 'desc' },
    });
    if (!schema)
      throw new NotFoundException(
        `No active form schema '${name}' found for this event`,
      );
    return schema;
  }

  /**
   * Create a new form schema (version 1) or a new version of an existing schema.
   */
  async createSchema(data: {
    eventId: string;
    name: string;
    fields: FormSchemaDefinition;
  }) {
    // Validate field definitions
    this.validateFields(data.fields.fields);

    // Find the latest version of this schema name
    const latest = await this.prisma.formSchema.findFirst({
      where: { eventId: data.eventId, name: data.name },
      orderBy: { version: 'desc' },
    });

    const newVersion = latest ? latest.version + 1 : 1;

    // Deactivate previous versions
    if (latest) {
      await this.prisma.formSchema.updateMany({
        where: { eventId: data.eventId, name: data.name },
        data: { active: false },
      });
    }

    return this.prisma.formSchema.create({
      data: {
        eventId: data.eventId,
        name: data.name,
        version: newVersion,
        fields: data.fields as any,
        active: true,
      },
    });
  }

  /**
   * Deactivate a form schema (doesn't delete — submissions reference it).
   */
  async deactivateSchema(id: string, eventId: string) {
    await this.findSchema(id, eventId);
    return this.prisma.formSchema.update({
      where: { id },
      data: { active: false },
    });
  }

  // ─── Schema for Public (unauthenticated) ──────────────────────

  /**
   * Get the active form schema for a ticket type (public-facing).
   * Used by the Client widget to render the registration form.
   */
  async findSchemaForTicketType(eventId: string, ticketTypeId: string) {
    const ticketType = await this.prisma.ticketType.findFirst({
      where: { id: ticketTypeId, eventId },
      select: { formSchemaId: true },
    });

    if (!ticketType?.formSchemaId) {
      return null; // No custom form — just collect basic info
    }

    return this.prisma.formSchema.findUnique({
      where: { id: ticketType.formSchemaId },
      select: { id: true, name: true, version: true, fields: true },
    });
  }

  // ─── Submissions ──────────────────────────────────────────────

  /**
   * Submit form data for an attendee.
   * Validates data against the schema before storing.
   */
  async createSubmission(data: {
    eventId: string;
    attendeeId: string;
    formSchemaId: string;
    answers: Record<string, unknown>;
  }) {
    // Load the schema
    const schema = await this.prisma.formSchema.findUnique({
      where: { id: data.formSchemaId },
    });
    if (!schema)
      throw new NotFoundException(
        `Form schema ${data.formSchemaId} not found`,
      );

    // Validate answers against schema fields
    const fields = (schema.fields as unknown as FormSchemaDefinition).fields;
    this.validateSubmission(fields, data.answers);

    return this.prisma.formSubmission.create({
      data: {
        eventId: data.eventId,
        attendeeId: data.attendeeId,
        formSchemaId: data.formSchemaId,
        data: data.answers as any,
      },
    });
  }

  /**
   * Get submissions for an attendee.
   */
  async findSubmissionsByAttendee(eventId: string, attendeeId: string) {
    return this.prisma.formSubmission.findMany({
      where: { eventId, attendeeId },
      include: {
        formSchema: { select: { name: true, version: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  /**
   * Get all submissions for an event (optionally filtered by schema).
   */
  async findSubmissionsByEvent(
    eventId: string,
    options: { formSchemaId?: string; take?: number; skip?: number } = {},
  ) {
    const { formSchemaId, take = 100, skip = 0 } = options;
    return this.prisma.formSubmission.findMany({
      where: {
        eventId,
        ...(formSchemaId ? { formSchemaId } : {}),
      },
      include: {
        attendee: { select: { firstName: true, lastName: true, email: true } },
        formSchema: { select: { name: true, version: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take,
      skip,
    });
  }

  // ─── Validation ───────────────────────────────────────────────

  /**
   * Validate field definitions in a schema.
   */
  private validateFields(fields: FormField[]) {
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new BadRequestException('Schema must contain at least one field');
    }

    const ids = new Set<string>();
    for (const field of fields) {
      if (!field.id || !field.type || !field.label) {
        throw new BadRequestException(
          `Field must have id, type, and label properties`,
        );
      }
      if (ids.has(field.id)) {
        throw new BadRequestException(`Duplicate field id: ${field.id}`);
      }
      ids.add(field.id);
    }
  }

  /**
   * Validate submission data against schema fields.
   * Checks required fields and basic type coercion.
   */
  private validateSubmission(
    fields: FormField[],
    answers: Record<string, unknown>,
  ) {
    for (const field of fields) {
      const value = answers[field.id];

      // Check required fields
      if (field.required && (value === undefined || value === null || value === '')) {
        throw new BadRequestException(
          `Required field '${field.id}' is missing`,
        );
      }

      if (value === undefined || value === null) continue;

      // Basic type validation
      switch (field.type) {
        case 'email':
          if (typeof value !== 'string' || !value.includes('@')) {
            throw new BadRequestException(
              `Field '${field.id}' must be a valid email`,
            );
          }
          break;
        case 'number':
          if (typeof value !== 'number' && isNaN(Number(value))) {
            throw new BadRequestException(
              `Field '${field.id}' must be a number`,
            );
          }
          break;
        case 'multi-select':
          if (!Array.isArray(value)) {
            throw new BadRequestException(
              `Field '${field.id}' must be an array`,
            );
          }
          break;
        case 'consent':
          if (typeof value !== 'object' || value === null) {
            throw new BadRequestException(
              `Consent field '${field.id}' must include granted and timestamp`,
            );
          }
          break;
      }

      // String length validation
      if (
        typeof value === 'string' &&
        field.validation
      ) {
        const v = field.validation;
        if (v.minLength && value.length < (v.minLength as number)) {
          throw new BadRequestException(
            `Field '${field.id}' must be at least ${v.minLength} characters`,
          );
        }
        if (v.maxLength && value.length > (v.maxLength as number)) {
          throw new BadRequestException(
            `Field '${field.id}' must be at most ${v.maxLength} characters`,
          );
        }
      }
    }
  }
}
