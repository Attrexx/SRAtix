import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FieldRepositoryService } from '../field-repository/field-repository.service';
import {
  ConditionRule,
  evaluateConditions,
} from '../common/conditions';
import * as sanitizeHtml from 'sanitize-html';
import * as sharp from 'sharp';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';

/**
 * Supported form field types per PRODUCTION-ARCHITECTURE.md §8.
 */
export type FieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'url'
  | 'select'
  | 'multi-select'
  | 'checkbox'
  | 'radio'
  | 'textarea'
  | 'richtext'
  | 'date'
  | 'file'
  | 'image-upload'
  | 'number'
  | 'country'
  | 'canton'
  | 'consent'
  | 'yes-no'
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
  width?: number; // Display width percentage: 25 | 33 | 50 | 66 | 75 | 100
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
  documentUrl?: Record<string, string>;
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
  maxStaff?: number;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldRepo: FieldRepositoryService,
  ) {}

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

  /**
   * Update an existing form schema's name and/or fields.
   * Creates a new version if there are existing submissions referencing this schema.
   */
  async updateSchema(
    id: string,
    eventId: string,
    data: { name?: string; fields?: FormSchemaDefinition },
  ) {
    const existing = await this.findSchema(id, eventId);

    if (data.fields) {
      this.validateFields(data.fields.fields);
    }

    // Check if submissions exist — if so, create a new version instead of mutating
    const submissionCount = await this.prisma.formSubmission.count({
      where: { formSchemaId: id },
    });

    if (submissionCount > 0) {
      // Immutable: deactivate old, create new version
      await this.prisma.formSchema.update({
        where: { id },
        data: { active: false },
      });
      const newSchema = await this.prisma.formSchema.create({
        data: {
          eventId,
          name: data.name ?? existing.name,
          version: existing.version + 1,
          fields: (data.fields ?? existing.fields) as any,
          active: true,
        },
      });

      // Cascade: update any ticket types still referencing the old schema
      await this.prisma.ticketType.updateMany({
        where: { formSchemaId: id },
        data: { formSchemaId: newSchema.id },
      });

      return newSchema;
    }

    // No submissions — safe to update in place
    return this.prisma.formSchema.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.fields !== undefined && { fields: data.fields as any }),
      },
    });
  }

  /**
   * Delete a form schema. Only allowed if no submissions reference it.
   */
  async deleteSchema(id: string, eventId: string) {
    await this.findSchema(id, eventId);

    const submissionCount = await this.prisma.formSubmission.count({
      where: { formSchemaId: id },
    });
    if (submissionCount > 0) {
      throw new BadRequestException(
        'Cannot delete a form schema that has submissions. Deactivate it instead.',
      );
    }

    return this.prisma.formSchema.delete({ where: { id } });
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

    return this.findSchemaById(ticketType.formSchemaId);
  }

  /**
   * Find a form schema from ANY active ticket type in the event.
   * Used as a fallback when the specific ticket type (e.g. Complimentary)
   * doesn't have a formSchemaId assigned.
   */
  async findFallbackSchemaForEvent(eventId: string) {
    const ticketType = await this.prisma.ticketType.findFirst({
      where: {
        eventId,
        formSchemaId: { not: null },
        status: 'active',
      },
      select: { formSchemaId: true },
      orderBy: { sortOrder: 'asc' },
    });

    if (!ticketType?.formSchemaId) return null;

    return this.findSchemaById(ticketType.formSchemaId);
  }

  /**
   * Load and hydrate a form schema by its ID.
   */
  private async findSchemaById(schemaId: string) {
    const schema = await this.prisma.formSchema.findUnique({
      where: { id: schemaId },
      select: { id: true, name: true, version: true, fields: true },
    });

    if (!schema) return null;

    // Hydrate field options from the Field Repository for any select/multi-select/
    // country/canton fields that have no inline options in the schema snapshot.
    await this.hydrateFieldOptions(schema);

    return schema;
  }

  /**
   * For each field in the schema that is a select-like type with an empty or
   * missing `options` array, look up matching FieldDefinition by slug and
   * copy its options into the schema payload sent to the client.
   */
  private async hydrateFieldOptions(
    schema: { fields: unknown },
  ): Promise<void> {
    const def = schema.fields as FormSchemaDefinition | null;
    if (!def?.fields?.length) return;

    // Collect field IDs that need hydration
    const selectTypes = new Set(['select', 'multi-select', 'country', 'canton']);
    const needsHydration = def.fields.filter(
      (f) => selectTypes.has(f.type) && (!f.options || f.options.length === 0),
    );
    if (needsHydration.length === 0) return;

    // Batch-fetch all matching FieldDefinitions by slug.
    // Fields from seed templates use id = slug directly;
    // fields from the Dashboard builder store the slug in a separate property.
    const slugs = needsHydration.map((f) => (f as any).slug || f.id);
    const fieldDefs = await this.prisma.fieldDefinition.findMany({
      where: { slug: { in: slugs }, active: true },
      select: { slug: true, options: true },
    });

    const optionsBySlug = new Map<string, unknown>();
    for (const fd of fieldDefs) {
      if (fd.options) optionsBySlug.set(fd.slug, fd.options);
    }

    // Merge options into the schema fields
    for (const field of needsHydration) {
      const fieldSlug = (field as any).slug || field.id;
      const opts = optionsBySlug.get(fieldSlug);
      if (Array.isArray(opts) && opts.length > 0) {
        field.options = opts as FormField['options'];
      } else if (field.type === 'country') {
        // Built-in fallback: country fields always get the ISO 3166-1 list
        field.options = COUNTRY_OPTIONS;
      }
    }

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
   * Upsert form submission — update if one exists, create otherwise.
   * Used when attendees re-visit their registration form.
   */
  async upsertSubmission(data: {
    eventId: string;
    attendeeId: string;
    formSchemaId: string;
    answers: Record<string, unknown>;
  }) {
    const existing = await this.prisma.formSubmission.findFirst({
      where: {
        eventId: data.eventId,
        attendeeId: data.attendeeId,
        formSchemaId: data.formSchemaId,
      },
      orderBy: { submittedAt: 'desc' },
    });

    const schema = await this.prisma.formSchema.findUnique({
      where: { id: data.formSchemaId },
    });
    if (!schema)
      throw new NotFoundException(`Form schema ${data.formSchemaId} not found`);

    const fields = (schema.fields as unknown as FormSchemaDefinition).fields;
    this.validateSubmission(fields, data.answers);

    if (existing) {
      return this.prisma.formSubmission.update({
        where: { id: existing.id },
        data: { data: data.answers as any, submittedAt: new Date() },
      });
    }

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
   * Get the latest form submission for an attendee + schema combination.
   */
  async findLatestSubmission(attendeeId: string, formSchemaId: string) {
    return this.prisma.formSubmission.findFirst({
      where: { attendeeId, formSchemaId },
      orderBy: { submittedAt: 'desc' },
      select: { data: true, submittedAt: true },
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

  // ─── Image Upload (public registration flow) ──────────────────

  /** Allowed MIME types for image uploads. */
  private static readonly ALLOWED_IMAGE_MIMES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ]);

  /**
   * Upload and optimize an image for a registration form field.
   * Stores in /uploads/registrations/{uuid}.webp and returns the public URL.
   * No auth required — rate-limited by the controller.
   */
  async uploadFormImage(
    fileBuffer: Buffer,
    mimetype: string,
    originalName: string,
  ): Promise<{ url: string }> {
    if (!FormsService.ALLOWED_IMAGE_MIMES.has(mimetype)) {
      throw new BadRequestException(
        'Only image files are accepted (JPEG, PNG, WebP, GIF)',
      );
    }

    // Optimize: resize to max 512×512, convert to WebP
    const optimized = await sharp(fileBuffer)
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    const uploadsBase = resolve(__dirname, '..', '..', 'uploads', 'registrations');
    mkdirSync(uploadsBase, { recursive: true });

    const fileId = randomBytes(16).toString('hex');
    const filename = `${fileId}.webp`;
    const filePath = join(uploadsBase, filename);
    writeFileSync(filePath, optimized);

    const publicUrl = `/uploads/registrations/${filename}`;

    this.logger.log(
      `Form image uploaded: ${originalName} → ${filename} (${optimized.length} bytes)`,
    );

    return { url: publicUrl };
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
   * Respects field conditions: if a field's conditions evaluate to false
   * (field is hidden), its required check is skipped and its value is stripped.
   */
  private static readonly CORE_ATTENDEE_FIELDS = new Set([
    'first_name', 'last_name', 'email', 'phone', 'company', 'organization',
    'firstName', 'lastName',
  ]);

  private validateSubmission(
    fields: FormField[],
    answers: Record<string, unknown>,
  ) {
    for (const field of fields) {
      // Core attendee fields are handled separately by the registration endpoint
      // and stripped from formData by the frontend — skip their validation here.
      if (FormsService.CORE_ATTENDEE_FIELDS.has(field.id)) continue;

      // Evaluate conditions — if field should be hidden, skip validation
      if (field.conditions && field.conditions.length > 0) {
        const visible = evaluateConditions(
          field.conditions as ConditionRule[],
          answers,
        );
        if (!visible) {
          // Field is conditionally hidden — strip any submitted value and skip
          delete answers[field.id];
          continue;
        }
      }

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
        case 'richtext':
          if (typeof value !== 'string') {
            throw new BadRequestException(
              `Field '${field.id}' must be a string`,
            );
          }
          // Sanitize HTML — allow only safe formatting tags
          answers[field.id] = sanitizeHtml(value, {
            allowedTags: ['b', 'i', 'u', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'p', 'br'],
            allowedAttributes: { a: ['href'] },
            allowedSchemes: ['https', 'http', 'mailto'],
          });
          break;
        case 'image-upload':
        case 'file':
          // Accept URL string from prior upload, or empty string
          if (typeof value !== 'string') {
            throw new BadRequestException(
              `Field '${field.id}' must be a URL string`,
            );
          }
          // Only allow our own /uploads/ paths — prevent arbitrary URL injection
          if (value !== '' && !value.startsWith('/uploads/')) {
            throw new BadRequestException(
              `Field '${field.id}' contains an invalid upload URL`,
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

// ─── Built-in country list (ISO 3166-1, Switzerland first) ───────────────────

const COUNTRY_OPTIONS: FormField['options'] = [
  { value: 'ch', label: { en: 'Switzerland', de: 'Schweiz', fr: 'Suisse', it: 'Svizzera', 'zh-TW': '瑞士' } },
  { value: 'de', label: { en: 'Germany', de: 'Deutschland', fr: 'Allemagne', it: 'Germania', 'zh-TW': '德國' } },
  { value: 'fr', label: { en: 'France', de: 'Frankreich', fr: 'France', it: 'Francia', 'zh-TW': '法國' } },
  { value: 'at', label: { en: 'Austria', de: 'Österreich', fr: 'Autriche', it: 'Austria', 'zh-TW': '奧地利' } },
  { value: 'it', label: { en: 'Italy', de: 'Italien', fr: 'Italie', it: 'Italia', 'zh-TW': '義大利' } },
  { value: 'li', label: { en: 'Liechtenstein', de: 'Liechtenstein', fr: 'Liechtenstein', it: 'Liechtenstein', 'zh-TW': '列支敦斯登' } },
  { value: 'gb', label: { en: 'United Kingdom', de: 'Vereinigtes Königreich', fr: 'Royaume-Uni', it: 'Regno Unito', 'zh-TW': '英國' } },
  { value: 'us', label: { en: 'United States', de: 'Vereinigte Staaten', fr: 'États-Unis', it: 'Stati Uniti', 'zh-TW': '美國' } },
  { value: 'nl', label: { en: 'Netherlands', de: 'Niederlande', fr: 'Pays-Bas', it: 'Paesi Bassi', 'zh-TW': '荷蘭' } },
  { value: 'be', label: { en: 'Belgium', de: 'Belgien', fr: 'Belgique', it: 'Belgio', 'zh-TW': '比利時' } },
  { value: 'lu', label: { en: 'Luxembourg', de: 'Luxemburg', fr: 'Luxembourg', it: 'Lussemburgo', 'zh-TW': '盧森堡' } },
  { value: 'es', label: { en: 'Spain', de: 'Spanien', fr: 'Espagne', it: 'Spagna', 'zh-TW': '西班牙' } },
  { value: 'pt', label: { en: 'Portugal', de: 'Portugal', fr: 'Portugal', it: 'Portogallo', 'zh-TW': '葡萄牙' } },
  { value: 'se', label: { en: 'Sweden', de: 'Schweden', fr: 'Suède', it: 'Svezia', 'zh-TW': '瑞典' } },
  { value: 'no', label: { en: 'Norway', de: 'Norwegen', fr: 'Norvège', it: 'Norvegia', 'zh-TW': '挪威' } },
  { value: 'dk', label: { en: 'Denmark', de: 'Dänemark', fr: 'Danemark', it: 'Danimarca', 'zh-TW': '丹麥' } },
  { value: 'fi', label: { en: 'Finland', de: 'Finnland', fr: 'Finlande', it: 'Finlandia', 'zh-TW': '芬蘭' } },
  { value: 'pl', label: { en: 'Poland', de: 'Polen', fr: 'Pologne', it: 'Polonia', 'zh-TW': '波蘭' } },
  { value: 'cz', label: { en: 'Czech Republic', de: 'Tschechien', fr: 'Tchéquie', it: 'Cechia', 'zh-TW': '捷克' } },
  { value: 'ie', label: { en: 'Ireland', de: 'Irland', fr: 'Irlande', it: 'Irlanda', 'zh-TW': '愛爾蘭' } },
  { value: 'gr', label: { en: 'Greece', de: 'Griechenland', fr: 'Grèce', it: 'Grecia', 'zh-TW': '希臘' } },
  { value: 'hu', label: { en: 'Hungary', de: 'Ungarn', fr: 'Hongrie', it: 'Ungheria', 'zh-TW': '匈牙利' } },
  { value: 'ro', label: { en: 'Romania', de: 'Rumänien', fr: 'Roumanie', it: 'Romania', 'zh-TW': '羅馬尼亞' } },
  { value: 'bg', label: { en: 'Bulgaria', de: 'Bulgarien', fr: 'Bulgarie', it: 'Bulgaria', 'zh-TW': '保加利亞' } },
  { value: 'hr', label: { en: 'Croatia', de: 'Kroatien', fr: 'Croatie', it: 'Croazia', 'zh-TW': '克羅埃西亞' } },
  { value: 'sk', label: { en: 'Slovakia', de: 'Slowakei', fr: 'Slovaquie', it: 'Slovacchia', 'zh-TW': '斯洛伐克' } },
  { value: 'si', label: { en: 'Slovenia', de: 'Slowenien', fr: 'Slovénie', it: 'Slovenia', 'zh-TW': '斯洛維尼亞' } },
  { value: 'ee', label: { en: 'Estonia', de: 'Estland', fr: 'Estonie', it: 'Estonia', 'zh-TW': '愛沙尼亞' } },
  { value: 'lv', label: { en: 'Latvia', de: 'Lettland', fr: 'Lettonie', it: 'Lettonia', 'zh-TW': '拉脫維亞' } },
  { value: 'lt', label: { en: 'Lithuania', de: 'Litauen', fr: 'Lituanie', it: 'Lituania', 'zh-TW': '立陶宛' } },
  { value: 'mt', label: { en: 'Malta', de: 'Malta', fr: 'Malte', it: 'Malta', 'zh-TW': '馬爾他' } },
  { value: 'cy', label: { en: 'Cyprus', de: 'Zypern', fr: 'Chypre', it: 'Cipro', 'zh-TW': '賽普勒斯' } },
  { value: 'is', label: { en: 'Iceland', de: 'Island', fr: 'Islande', it: 'Islanda', 'zh-TW': '冰島' } },
  { value: 'jp', label: { en: 'Japan', de: 'Japan', fr: 'Japon', it: 'Giappone', 'zh-TW': '日本' } },
  { value: 'kr', label: { en: 'South Korea', de: 'Südkorea', fr: 'Corée du Sud', it: 'Corea del Sud', 'zh-TW': '韓國' } },
  { value: 'cn', label: { en: 'China', de: 'China', fr: 'Chine', it: 'Cina', 'zh-TW': '中國' } },
  { value: 'tw', label: { en: 'Taiwan', de: 'Taiwan', fr: 'Taïwan', it: 'Taiwan', 'zh-TW': '台灣' } },
  { value: 'sg', label: { en: 'Singapore', de: 'Singapur', fr: 'Singapour', it: 'Singapore', 'zh-TW': '新加坡' } },
  { value: 'in', label: { en: 'India', de: 'Indien', fr: 'Inde', it: 'India', 'zh-TW': '印度' } },
  { value: 'il', label: { en: 'Israel', de: 'Israel', fr: 'Israël', it: 'Israele', 'zh-TW': '以色列' } },
  { value: 'au', label: { en: 'Australia', de: 'Australien', fr: 'Australie', it: 'Australia', 'zh-TW': '澳洲' } },
  { value: 'nz', label: { en: 'New Zealand', de: 'Neuseeland', fr: 'Nouvelle-Zélande', it: 'Nuova Zelanda', 'zh-TW': '紐西蘭' } },
  { value: 'ca', label: { en: 'Canada', de: 'Kanada', fr: 'Canada', it: 'Canada', 'zh-TW': '加拿大' } },
  { value: 'mx', label: { en: 'Mexico', de: 'Mexiko', fr: 'Mexique', it: 'Messico', 'zh-TW': '墨西哥' } },
  { value: 'br', label: { en: 'Brazil', de: 'Brasilien', fr: 'Brésil', it: 'Brasile', 'zh-TW': '巴西' } },
  { value: 'ar', label: { en: 'Argentina', de: 'Argentinien', fr: 'Argentine', it: 'Argentina', 'zh-TW': '阿根廷' } },
  { value: 'cl', label: { en: 'Chile', de: 'Chile', fr: 'Chili', it: 'Cile', 'zh-TW': '智利' } },
  { value: 'za', label: { en: 'South Africa', de: 'Südafrika', fr: 'Afrique du Sud', it: 'Sudafrica', 'zh-TW': '南非' } },
  { value: 'ae', label: { en: 'United Arab Emirates', de: 'Vereinigte Arabische Emirate', fr: 'Émirats arabes unis', it: 'Emirati Arabi Uniti', 'zh-TW': '阿拉伯聯合大公國' } },
  { value: 'sa', label: { en: 'Saudi Arabia', de: 'Saudi-Arabien', fr: 'Arabie saoudite', it: 'Arabia Saudita', 'zh-TW': '沙烏地阿拉伯' } },
  { value: 'tr', label: { en: 'Turkey', de: 'Türkei', fr: 'Turquie', it: 'Turchia', 'zh-TW': '土耳其' } },
  { value: 'ua', label: { en: 'Ukraine', de: 'Ukraine', fr: 'Ukraine', it: 'Ucraina', 'zh-TW': '烏克蘭' } },
  { value: 'rs', label: { en: 'Serbia', de: 'Serbien', fr: 'Serbie', it: 'Serbia', 'zh-TW': '塞爾維亞' } },
  { value: 'th', label: { en: 'Thailand', de: 'Thailand', fr: 'Thaïlande', it: 'Thailandia', 'zh-TW': '泰國' } },
  { value: 'my', label: { en: 'Malaysia', de: 'Malaysia', fr: 'Malaisie', it: 'Malesia', 'zh-TW': '馬來西亞' } },
  { value: 'id', label: { en: 'Indonesia', de: 'Indonesien', fr: 'Indonésie', it: 'Indonesia', 'zh-TW': '印尼' } },
  { value: 'ph', label: { en: 'Philippines', de: 'Philippinen', fr: 'Philippines', it: 'Filippine', 'zh-TW': '菲律賓' } },
  { value: 'eg', label: { en: 'Egypt', de: 'Ägypten', fr: 'Égypte', it: 'Egitto', 'zh-TW': '埃及' } },
  { value: 'ng', label: { en: 'Nigeria', de: 'Nigeria', fr: 'Nigeria', it: 'Nigeria', 'zh-TW': '奈及利亞' } },
  { value: 'ke', label: { en: 'Kenya', de: 'Kenia', fr: 'Kenya', it: 'Kenya', 'zh-TW': '肯亞' } },
  { value: 'co', label: { en: 'Colombia', de: 'Kolumbien', fr: 'Colombie', it: 'Colombia', 'zh-TW': '哥倫比亞' } },
  { value: 'pe', label: { en: 'Peru', de: 'Peru', fr: 'Pérou', it: 'Perù', 'zh-TW': '秘魯' } },
  { value: 'pk', label: { en: 'Pakistan', de: 'Pakistan', fr: 'Pakistan', it: 'Pakistan', 'zh-TW': '巴基斯坦' } },
  { value: 'bd', label: { en: 'Bangladesh', de: 'Bangladesch', fr: 'Bangladesh', it: 'Bangladesh', 'zh-TW': '孟加拉' } },
  { value: 'vn', label: { en: 'Vietnam', de: 'Vietnam', fr: 'Viêt Nam', it: 'Vietnam', 'zh-TW': '越南' } },
  { value: 'other', label: { en: 'Other', de: 'Andere', fr: 'Autre', it: 'Altro', 'zh-TW': '其他' } },
];
