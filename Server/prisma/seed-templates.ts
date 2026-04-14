/**
 * One-off script to re-seed form templates with force.
 * Bypasses the HTTP API — runs directly against the database.
 *
 * Usage:  npx ts-node --transpile-only prisma/seed-templates.ts
 */
import { PrismaClient } from '@prisma/client';
import { getSRD26TemplateSeedData } from '../src/form-templates/srd26-template-seeds';

const prisma = new PrismaClient();

async function main() {
  // Find an organizer org — try slug 'sra' first, then fall back to any organizer
  let org = await prisma.organization.findFirst({ where: { slug: 'sra' } });
  if (!org) {
    org = await prisma.organization.findFirst({ where: { type: 'organizer' } });
  }
  if (!org) {
    // List all orgs so the user can pick
    const all = await prisma.organization.findMany({ select: { id: true, name: true, slug: true, type: true } });
    console.error('No organizer org found. All organizations in DB:');
    console.table(all);
    process.exit(1);
  }
  console.log(`Found org: ${org.name} (slug: ${org.slug}, id: ${org.id})`);

  const templates = getSRD26TemplateSeedData();
  let created = 0, updated = 0;

  for (const tpl of templates) {
    const existing = await prisma.formTemplate.findFirst({
      where: { orgId: org.id, name: tpl.name },
    });

    if (existing) {
      await prisma.formTemplate.update({
        where: { id: existing.id },
        data: {
          description: tpl.description,
          category: tpl.category,
          fields: tpl.fields as any,
        },
      });
      console.log(`  ✔ Updated: ${tpl.name}`);
      updated++;
    } else {
      await prisma.formTemplate.create({
        data: {
          orgId: org.id,
          name: tpl.name,
          description: tpl.description,
          category: tpl.category,
          fields: tpl.fields as any,
        },
      });
      console.log(`  ✔ Created: ${tpl.name}`);
      created++;
    }
  }

  console.log(`\nDone: ${created} created, ${updated} updated.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
