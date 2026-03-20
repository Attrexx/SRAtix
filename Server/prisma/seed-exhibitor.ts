/**
 * Seed script — creates a demo exhibitor account with full portal access.
 *
 * Usage:  npx ts-node --transpile-only prisma/seed-exhibitor.ts
 *
 * Creates (idempotent): Organization → User → UserRole → Event (if none) →
 *   TicketType → Attendee → Ticket → ExhibitorProfile → EventExhibitor → Staff
 *
 * Login: POST /api/auth/login  { email, password }
 *        → Returns JWT with exhibitor role + orgId → full portal access.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

// ── Config ─────────────────────────────────────────────────────────────────
const TEST_EMAIL = 'demo-exhibitor@swiss-robotics.org';
const TEST_PASSWORD = 'DemoExh!2026';
const TEST_DISPLAY_NAME = 'Demo Exhibitor';
const ORG_NAME = 'Demo Robotics AG';
const ORG_SLUG = '_demo-exhibitor';
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Find or create an event ────────────────────────────────────────
  let event = await prisma.event.findFirst({
    where: { status: { notIn: ['cancelled', 'archived'] } },
    orderBy: { startDate: 'desc' },
  });
  if (!event) {
    // No event exists — create a demo one
    // Need an org first for the event
    let hostOrg = await prisma.organization.findFirst({
      where: { type: 'organizer' },
    });
    if (!hostOrg) {
      hostOrg = await prisma.organization.create({
        data: {
          name: 'Swiss Robotics Association',
          slug: 'sra',
          type: 'organizer',
          contactEmail: 'info@swiss-robotics.org',
          active: true,
        },
      });
      console.log(`✔ Created host org: ${hostOrg.name} (${hostOrg.id})`);
    }
    event = await prisma.event.create({
      data: {
        orgId: hostOrg.id,
        name: 'Swiss Robotics Day 2026',
        slug: 'srd-2026',
        description: 'The annual Swiss Robotics Day',
        venue: 'SwissTech Convention Center',
        venueAddress: 'Route Louis-Favre 2, 1024 Ecublens, Switzerland',
        startDate: new Date('2026-10-22T08:00:00+02:00'),
        endDate: new Date('2026-10-22T18:00:00+02:00'),
        doorsOpen: new Date('2026-10-22T07:30:00+02:00'),
        status: 'published',
        currency: 'CHF',
        maxCapacity: 2000,
        meta: {
          pagePaths: { exhibitorPortal: '/exhibitor-portal' },
          setupOptions: [
            { id: 'electricity', label: 'Extra Power Outlet (230V)', priceCents: 5000, category: 'infrastructure' },
            { id: 'wifi', label: 'Dedicated Wi-Fi Access Point', priceCents: 8000, category: 'infrastructure' },
            { id: 'monitor-24', label: '24" Monitor on Stand', priceCents: 15000, category: 'equipment' },
            { id: 'table-extra', label: 'Extra Table (120×60cm)', priceCents: 3500, category: 'furniture' },
          ],
        },
      },
    });
    console.log(`✔ Created event: ${event.name} (${event.id})`);
  } else {
    console.log(`✔ Using event: ${event.name} (${event.id})`);
  }

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
  let passwordChanged = false;
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
    // Reset password to known value on re-run
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, active: true },
    });
    passwordChanged = true;
    console.log(`✔ User exists: ${user.email} (${user.id}) — password reset`);
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
        firstName: 'Demo',
        lastName: 'Exhibitor',
        company: ORG_NAME,
        status: 'confirmed',
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
        code: `DEMO-EX-${randomBytes(6).toString('hex').toUpperCase()}`,
        status: 'valid',
      },
    });
    console.log(`✔ Issued ticket (${ticket.id})`);
  } else {
    console.log(`✔ Ticket exists (${ticket.id})`);
  }

  // ── 8. ExhibitorProfile ───────────────────────────────────────────────
  let profile = await prisma.exhibitorProfile.findUnique({
    where: { orgId: org.id },
  });
  if (!profile) {
    profile = await prisma.exhibitorProfile.create({
      data: {
        orgId: org.id,
        companyName: ORG_NAME,
        legalName: 'Demo Robotics AG',
        website: 'https://demo-robotics.example.com',
        description:
          '<p>Leading provider of collaborative robotic arms for manufacturing and ' +
          'research. Our cobots combine Swiss precision engineering with cutting-edge AI ' +
          'to deliver safe, intuitive automation solutions.</p>' +
          '<p>Founded in 2019, Demo Robotics serves 200+ customers across Europe in ' +
          'automotive, pharma, and food & beverage industries.</p>',
        contactEmail: TEST_EMAIL,
        contactPhone: '+41 21 555 0100',
        socialLinks: {
          linkedin: 'https://linkedin.com/company/demo-robotics',
          twitter: 'https://twitter.com/demorobotics',
          youtube: 'https://youtube.com/@demorobotics',
        },
        videoLinks: [
          { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embedType: 'youtube' },
        ],
      },
    });
    console.log(`✔ Created ExhibitorProfile (${profile.id})`);
  } else {
    console.log(`✔ ExhibitorProfile exists (${profile.id})`);
  }

  // ── 9. EventExhibitor ─────────────────────────────────────────────────
  let eventExhibitor = await prisma.eventExhibitor.findUnique({
    where: {
      eventId_exhibitorProfileId: {
        eventId: event.id,
        exhibitorProfileId: profile.id,
      },
    },
  });
  if (!eventExhibitor) {
    eventExhibitor = await prisma.eventExhibitor.create({
      data: {
        eventId: event.id,
        exhibitorProfileId: profile.id,
        boothNumber: 'A-12',
        expoArea: 'Hall 1 — Collaborative Robotics',
        exhibitorCategory: 'industry',
        exhibitorType: 'Premium Exhibitor',
        demoTitle: 'CoBot X3: AI-Powered Pick & Place',
        demoDescription:
          '<p>Live demonstration of our flagship CoBot X3 performing high-speed ' +
          'bin-picking with real-time object recognition. See how our AI adapts to ' +
          'unseen objects in under 200ms.</p>' +
          '<ul><li>6-axis collaborative arm with 5kg payload</li>' +
          '<li>RGB-D vision system with on-device ML inference</li>' +
          '<li>Safety-rated force limiting (ISO/TS 15066)</li></ul>',
        status: 'published',
        meta: {
          buyerName: TEST_DISPLAY_NAME,
          orderNumber: 'DEMO-001',
        },
      },
    });
    console.log(`✔ Created EventExhibitor (${eventExhibitor.id})`);
  } else {
    console.log(`✔ EventExhibitor exists (${eventExhibitor.id})`);
  }

  // ── 10. Booth Staff ───────────────────────────────────────────────────
  const staffCount = await prisma.exhibitorStaff.count({
    where: { eventExhibitorId: eventExhibitor.id },
  });
  if (staffCount === 0) {
    await prisma.exhibitorStaff.createMany({
      data: [
        {
          eventExhibitorId: eventExhibitor.id,
          firstName: 'Alice',
          lastName: 'Meier',
          email: 'alice.meier@demo-robotics.example.com',
          role: 'booth_manager',
          passStatus: 'registered',
        },
        {
          eventExhibitorId: eventExhibitor.id,
          firstName: 'Bruno',
          lastName: 'Keller',
          email: 'bruno.keller@demo-robotics.example.com',
          phone: '+41 79 555 0201',
          role: 'demo_presenter',
          passStatus: 'pending',
        },
      ],
    });
    console.log('✔ Created 2 booth staff members');
  } else {
    console.log(`✔ ${staffCount} booth staff already exist`);
  }

  // ── 11. WP mapping (update orgId if exists) ───────────────────────────
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
    console.log('ℹ No WP mapping — will be created on first WP login');
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Demo Exhibitor Account Ready');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Email:        ${TEST_EMAIL}`);
  console.log(`  Password:     ${TEST_PASSWORD}`);
  console.log(`  User ID:      ${user.id}`);
  console.log(`  Org ID:       ${org.id}`);
  console.log(`  Event:        ${event.name} (${event.id})`);
  console.log(`  Booth:        A-12 — Hall 1`);
  console.log(`  Profile ID:   ${profile.id}`);
  console.log(`  Demo:         CoBot X3: AI-Powered Pick & Place`);
  console.log(`  Staff:        2 members (Alice Meier, Bruno Keller)`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Login via API:');
  console.log(`    POST /api/auth/login`);
  console.log(`    { "email": "${TEST_EMAIL}", "password": "${TEST_PASSWORD}" }`);
  console.log('');
  console.log('  Then use the accessToken to call exhibitor portal endpoints.');
  console.log('');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
