/**
 * Seed script — creates a test exhibitor account with full portal access.
 *
 * Usage:  npx ts-node --transpile-only prisma/seed-exhibitor.ts
 *
 * Creates: Organization → User → UserRole → TicketType → Attendee → Ticket
 * Then the exhibitor portal will auto-create ExhibitorProfile on first access.
 *
 * Idempotent — skips if the email already exists.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

// ── Config ─────────────────────────────────────────────────────────────────
const TEST_EMAIL = 'test@rat.com';
const TEST_PASSWORD = '73@0d)fds_';
const TEST_DISPLAY_NAME = 'Test Exhibitor';
const ORG_NAME = 'Test Exhibitor Corp';
const ORG_SLUG = 'test-exhibitor-corp';
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Find the first active event ────────────────────────────────────
  const event = await prisma.event.findFirst({
    where: { status: { notIn: ['cancelled', 'archived'] } },
    orderBy: { startDate: 'desc' },
  });
  if (!event) {
    console.error('✘ No active event found. Create an event first.');
    process.exit(1);
  }
  console.log(`✔ Using event: ${event.name} (${event.id})`);

  // ── 2. Create or find Organization ────────────────────────────────────
  let org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: ORG_NAME,
        slug: ORG_SLUG,
        type: 'exhibitor',
        contactEmail: TEST_EMAIL,
        active: true,
      },
    });
    console.log(`✔ Created organization: ${org.name} (${org.id})`);
  } else {
    console.log(`✔ Organization exists: ${org.name} (${org.id})`);
  }

  // ── 3. Create or find User ────────────────────────────────────────────
  let user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (!user) {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
    user = await prisma.user.create({
      data: {
        email: TEST_EMAIL,
        displayName: TEST_DISPLAY_NAME,
        passwordHash,
        emailConfirmedAt: new Date(),
        active: true,
      },
    });
    console.log(`✔ Created user: ${user.email} (${user.id})`);
  } else {
    console.log(`✔ User exists: ${user.email} (${user.id})`);
  }

  // ── 4. Assign exhibitor role (scoped to org) ─────────────────────────
  const existingRole = await prisma.userRole.findFirst({
    where: { userId: user.id, orgId: org.id, role: 'exhibitor' },
  });
  if (!existingRole) {
    await prisma.userRole.create({
      data: { userId: user.id, orgId: org.id, role: 'exhibitor' },
    });
    console.log('✔ Assigned exhibitor role');
  } else {
    console.log('✔ Exhibitor role already assigned');
  }

  // ── 5. Create or find exhibitor TicketType for this event ─────────────
  let ticketType = await prisma.ticketType.findFirst({
    where: { eventId: event.id, category: 'exhibitor' },
  });
  if (!ticketType) {
    ticketType = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: 'Exhibitor Booth Pass',
        category: 'exhibitor',
        priceCents: 0,
        status: 'active',
        maxStaff: 5,
      },
    });
    console.log(`✔ Created exhibitor ticket type (${ticketType.id})`);
  } else {
    console.log(`✔ Exhibitor ticket type exists (${ticketType.id})`);
  }

  // ── 6. Create or find Attendee ────────────────────────────────────────
  let attendee = await prisma.attendee.findUnique({
    where: { eventId_email: { eventId: event.id, email: TEST_EMAIL } },
  });
  if (!attendee) {
    attendee = await prisma.attendee.create({
      data: {
        eventId: event.id,
        orgId: org.id,
        email: TEST_EMAIL,
        firstName: 'Test',
        lastName: 'Exhibitor',
        status: 'registered',
      },
    });
    console.log(`✔ Created attendee (${attendee.id})`);
  } else {
    console.log(`✔ Attendee exists (${attendee.id})`);
  }

  // ── 7. Issue Ticket ───────────────────────────────────────────────────
  let ticket = await prisma.ticket.findFirst({
    where: {
      eventId: event.id,
      attendeeId: attendee.id,
      ticketTypeId: ticketType.id,
    },
  });
  if (!ticket) {
    ticket = await prisma.ticket.create({
      data: {
        eventId: event.id,
        orgId: org.id,
        ticketTypeId: ticketType.id,
        attendeeId: attendee.id,
        code: randomBytes(25).toString('hex').toUpperCase().slice(0, 50),
        status: 'valid',
      },
    });
    console.log(`✔ Issued ticket (${ticket.id})`);
  } else {
    console.log(`✔ Ticket exists (${ticket.id})`);
  }

  // ── 8. If user has a WP mapping, update orgId ────────────────────────
  const wpMapping = await prisma.wpMapping.findFirst({
    where: { sratixEntityType: 'user', sratixEntityId: user.id },
  });
  if (wpMapping && wpMapping.orgId !== org.id) {
    await prisma.wpMapping.update({
      where: { id: wpMapping.id },
      data: { orgId: org.id },
    });
    console.log('✔ Updated WP mapping with org ID');
  } else if (wpMapping) {
    console.log('✔ WP mapping already linked to org');
  } else {
    console.log('ℹ No WP mapping yet — will be created on first WP login');
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  Test Exhibitor Account Ready');
  console.log('═══════════════════════════════════════════');
  console.log(`  Email:    ${TEST_EMAIL}`);
  console.log(`  Password: (as configured)`);
  console.log(`  User ID:  ${user.id}`);
  console.log(`  Org ID:   ${org.id}`);
  console.log(`  Event:    ${event.name}`);
  console.log(`  Ticket:   ${ticket.code}`);
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('  Next steps:');
  console.log('  1. Create a WordPress user with email: ' + TEST_EMAIL);
  console.log('  2. Assign the role: sratix_exhibitor');
  console.log('  3. Visit the Exhibitor Portal page while logged in');
  console.log('  4. The WP → SRAtix mapping will auto-link on first visit');
  console.log('');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
