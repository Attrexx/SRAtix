import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FormSchemaDefinition } from '../forms/forms.service';
import { getSRD26TemplateSeedData } from './srd26-template-seeds';

/**
 * Form Templates Service — manages reusable form configurations.
 *
 * Templates are scoped to an Organization, not per-user. Any admin
 * within the org can see/use templates saved by other admins.
 *
 * Workflow:
 *   1. Admin builds a form in the visual builder.
 *   2. Clicks "Save as Template" → creates a FormTemplate.
 *   3. Later, when creating a new FormSchema, clicks "Load Template"
 *      → the template's fields pre-populate the builder.
 *   4. The FormSchema is a separate, versioned record attached to an event.
 */
@Injectable()
export class FormTemplatesService {
  private readonly logger = new Logger(FormTemplatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all templates for an organization.
   */
  async findByOrg(orgId: string, category?: string) {
    const where: Record<string, unknown> = { orgId };
    if (category) {
      where.OR = [{ category }, { category: null }];
    }
    return this.prisma.formTemplate.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get a single template by ID.
   */
  async findOne(id: string, orgId: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: { id, orgId },
    });
    if (!template)
      throw new NotFoundException(`Form template ${id} not found`);
    return template;
  }

  /**
   * Create a new template.
   */
  async create(data: {
    orgId: string;
    name: string;
    description?: string;
    category?: string;
    fields: FormSchemaDefinition;
  }) {
    // Check name uniqueness within org
    const existing = await this.prisma.formTemplate.findFirst({
      where: { orgId: data.orgId, name: data.name },
    });
    if (existing) {
      throw new ConflictException(
        `Template '${data.name}' already exists in this organization`,
      );
    }

    return this.prisma.formTemplate.create({
      data: {
        orgId: data.orgId,
        name: data.name,
        description: data.description,
        category: data.category,
        fields: data.fields as any,
      },
    });
  }

  /**
   * Update a template.
   */
  async update(
    id: string,
    orgId: string,
    data: Partial<{
      name: string;
      description: string;
      category: string;
      fields: FormSchemaDefinition;
    }>,
  ) {
    await this.findOne(id, orgId);

    // If renaming, check uniqueness
    if (data.name) {
      const existing = await this.prisma.formTemplate.findFirst({
        where: { orgId, name: data.name, NOT: { id } },
      });
      if (existing) {
        throw new ConflictException(
          `Template '${data.name}' already exists in this organization`,
        );
      }
    }

    return this.prisma.formTemplate.update({
      where: { id },
      data: data as any,
    });
  }

  /**
   * Delete a template.
   */
  async delete(id: string, orgId: string) {
    await this.findOne(id, orgId);
    return this.prisma.formTemplate.delete({ where: { id } });
  }

  /**
   * Duplicate a template with a new name.
   */
  async duplicate(id: string, orgId: string, newName: string) {
    const source = await this.findOne(id, orgId);
    return this.create({
      orgId,
      name: newName,
      description: source.description ?? undefined,
      category: source.category ?? undefined,
      fields: source.fields as unknown as FormSchemaDefinition,
    });
  }

  // ─── Template Seeding ───────────────────────────────────────

  /**
   * Seed SRD26 pre-made form templates for an organization.
   *
   * Idempotent: templates already present (matched by name + orgId)
   * are skipped. Returns a summary of created vs skipped templates.
   *
   * @param orgId  The organization to seed templates into.
   * @param force  If true, update existing templates with seed data.
   */
  async seedTemplatesForOrg(
    orgId: string,
    force = false,
  ): Promise<{ created: string[]; skipped: string[]; updated: string[] }> {
    const templates = getSRD26TemplateSeedData();
    const created: string[] = [];
    const skipped: string[] = [];
    const updated: string[] = [];

    for (const tpl of templates) {
      const existing = await this.prisma.formTemplate.findFirst({
        where: { orgId, name: tpl.name },
      });

      if (existing && !force) {
        skipped.push(tpl.name);
        this.logger.debug(`Seed skipped (exists): ${tpl.name}`);
        continue;
      }

      if (existing && force) {
        await this.prisma.formTemplate.update({
          where: { id: existing.id },
          data: {
            description: tpl.description,
            category: tpl.category,
            fields: tpl.fields as any,
          },
        });
        updated.push(tpl.name);
        this.logger.log(`Seed updated: ${tpl.name}`);
        continue;
      }

      await this.prisma.formTemplate.create({
        data: {
          orgId,
          name: tpl.name,
          description: tpl.description,
          category: tpl.category,
          fields: tpl.fields as any,
        },
      });
      created.push(tpl.name);
      this.logger.log(`Seed created: ${tpl.name}`);
    }

    this.logger.log(
      `Seed summary for org ${orgId}: ${created.length} created, ${updated.length} updated, ${skipped.length} skipped`,
    );
    return { created, skipped, updated };
  }
}
