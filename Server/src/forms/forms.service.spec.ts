import { FormsService } from './forms.service';
import { PrismaService } from '../prisma/prisma.service';
import { FieldRepositoryService } from '../field-repository/field-repository.service';

/**
 * Unit tests for FormsService option hydration.
 *
 * Focus: a schema field's FieldDefinition is resolved by `slug` when present
 * and by `id` as a fallback. The fallback matters because the Dashboard form
 * builder rewrites a seed-template field's slug from its English label on save
 * (`expertise_area` becomes `field_s_of_experience`), which used to leave the
 * centrally managed dropdowns with no options at all.
 */
describe('FormsService — field option hydration', () => {
  let service: FormsService;
  let prisma: {
    ticketType: { findFirst: jest.Mock };
    formSchema: { findUnique: jest.Mock };
    fieldDefinition: { findMany: jest.Mock };
  };

  const EXPERTISE_OPTIONS = [
    { value: 'slam', label: { en: 'SLAM & Sensor Fusion' } },
    { value: 'ros', label: { en: 'ROS / Middleware Systems' } },
  ];

  /** A seed-template field whose slug was overwritten by a builder save. */
  const renamedTemplateField = {
    id: 'expertise_area',
    slug: 'field_s_of_experience',
    type: 'multi-select',
    label: { en: 'Field(s) of experience' },
  };

  const loadSchema = (fields: unknown[]) => {
    prisma.ticketType.findFirst.mockResolvedValue({ formSchemaId: 'schema-1' });
    prisma.formSchema.findUnique.mockResolvedValue({
      id: 'schema-1',
      name: 'SRD26 — Student Participant',
      version: 2,
      fields: { fields },
    });
    return service.findSchemaForTicketType('event-1', 'tt-1');
  };

  const fieldsOf = (schema: any) => schema.fields.fields;

  beforeEach(() => {
    prisma = {
      ticketType: { findFirst: jest.fn() },
      formSchema: { findUnique: jest.fn() },
      fieldDefinition: {
        findMany: jest.fn().mockResolvedValue([
          { slug: 'expertise_area', options: EXPERTISE_OPTIONS, tooltip: null, defaultValue: null },
        ]),
      },
    };
    service = new FormsService(
      prisma as unknown as PrismaService,
      {} as unknown as FieldRepositoryService,
    );
  });

  it('falls back to the field id when the slug matches no FieldDefinition', async () => {
    const schema = await loadSchema([{ ...renamedTemplateField }]);

    expect(fieldsOf(schema)[0].options).toEqual(EXPERTISE_OPTIONS);
  });

  it('queries FieldDefinition for both the slug and the id', async () => {
    await loadSchema([{ ...renamedTemplateField }]);

    const queried = prisma.fieldDefinition.findMany.mock.calls[0][0].where.slug.in;
    expect(queried).toEqual(
      expect.arrayContaining(['field_s_of_experience', 'expertise_area']),
    );
  });

  it('force-overwrites curated options even when the schema has stale inline ones', async () => {
    const schema = await loadSchema([
      {
        ...renamedTemplateField,
        options: [{ value: 'outdated', label: { en: 'Outdated' } }],
      },
    ]);

    expect(fieldsOf(schema)[0].options).toEqual(EXPERTISE_OPTIONS);
  });

  it('prefers a slug match over the id when both resolve', async () => {
    prisma.fieldDefinition.findMany.mockResolvedValue([
      { slug: 'expertise_area', options: EXPERTISE_OPTIONS, tooltip: null, defaultValue: null },
      { slug: 'study_level', options: [{ value: 'msc', label: { en: 'MSc' } }], tooltip: null, defaultValue: null },
    ]);

    const schema = await loadSchema([
      { id: 'expertise_area', slug: 'study_level', type: 'select', label: { en: 'Level of study' } },
    ]);

    expect(fieldsOf(schema)[0].options).toEqual([
      { value: 'msc', label: { en: 'MSc' } },
    ]);
  });

  it('leaves builder-created fields with no matching definition untouched', async () => {
    prisma.fieldDefinition.findMany.mockResolvedValue([]);

    const schema = await loadSchema([
      {
        id: 'field_1750000000000_ab3xy',
        slug: 'how_did_you_hear_about_us',
        type: 'select',
        label: { en: 'How did you hear about us?' },
      },
    ]);

    expect(fieldsOf(schema)[0].options).toBeUndefined();
  });
});
