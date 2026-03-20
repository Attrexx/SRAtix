/**
 * Seed script — creates the Super Admin account + demo exhibitor.
 *
 * Usage:  npx ts-node --transpile-only prisma/seed.ts
 *
 * Idempotent — safe to re-run. Resets passwords to known values each time.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

// ── Known credentials (printed at the end) ─────────────────────────────────
const ADMIN_EMAIL = 'attrexx@gmail.com';
const ADMIN_PASSWORD = 'SraAdmin!2026';

const DEMO_EMAIL = 'demo-exhibitor@swiss-robotics.org';
const DEMO_PASSWORD = 'DemoExh!2026';
// ────────────────────────────────────────────────────────────────────────────

async function seedSuperAdmin() {
  console.log('\n── Super Admin ────────────────────────────');
  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });

  if (existing) {
    // Reset password to known value
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, active: true },
    });
    console.log(`✔ Super Admin exists (${existing.id}) — password reset`);

    const hasRole = await prisma.userRole.findFirst({
      where: { userId: existing.id, role: 'super_admin' },
    });
    if (!hasRole) {
      await prisma.userRole.create({
        data: { userId: existing.id, role: 'super_admin' },
      });
      console.log('  → Added super_admin role');
    }
    return existing;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const user = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      displayName: 'Super Admin',
      passwordHash,
      emailConfirmedAt: new Date(),
      active: true,
    },
  });

  await prisma.userRole.create({
    data: { userId: user.id, role: 'super_admin' },
  });

  console.log(`✔ Created Super Admin (${user.id})`);
  return user;
}

async function seedDemoExhibitor() {
  console.log('\n── Demo Exhibitor ─────────────────────────');

  // Event
  let event = await prisma.event.findFirst({
    where: { status: { notIn: ['cancelled', 'archived'] } },
    orderBy: { startDate: 'desc' },
  });
  if (!event) {
    let hostOrg = await prisma.organization.findFirst({ where: { type: 'organizer' } });
    if (!hostOrg) {
      hostOrg = await prisma.organization.create({
        data: { name: 'Swiss Robotics Association', slug: 'sra', type: 'organizer', contactEmail: 'info@swiss-robotics.org', active: true },
      });
    }
    event = await prisma.event.create({
      data: {
        orgId: hostOrg.id, name: 'Swiss Robotics Day 2026', slug: 'srd-2026',
        venue: 'SwissTech Convention Center', venueAddress: 'Route Louis-Favre 2, 1024 Ecublens',
        startDate: new Date('2026-10-22T08:00:00+02:00'), endDate: new Date('2026-10-22T18:00:00+02:00'),
        doorsOpen: new Date('2026-10-22T07:30:00+02:00'), status: 'published', currency: 'CHF', maxCapacity: 2000,
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
    console.log(`✔ Created event: ${event.name}`);
  } else {
    console.log(`✔ Using event: ${event.name}`);
  }

  // Org
  let org = await prisma.organization.findUnique({ where: { slug: '_demo-exhibitor' } });
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Demo Robotics AG', slug: '_demo-exhibitor', type: 'exhibitor', contactEmail: DEMO_EMAIL, active: true },
    });
    console.log(`✔ Created org: ${org.name}`);
  } else {
    console.log(`✔ Org exists: ${org.name}`);
  }

  // User
  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
    user = await prisma.user.create({
      data: { email: DEMO_EMAIL, displayName: 'Demo Exhibitor', passwordHash: hash, emailConfirmedAt: new Date(), active: true },
    });
    console.log(`✔ Created user: ${user.email}`);
  } else {
    const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash, active: true } });
    console.log(`✔ User exists: ${user.email} — password reset`);
  }

  // Role
  const hasRole = await prisma.userRole.findFirst({ where: { userId: user.id, orgId: org.id, role: 'exhibitor' } });
  if (!hasRole) {
    await prisma.userRole.create({ data: { userId: user.id, orgId: org.id, role: 'exhibitor' } });
    console.log('✔ Assigned exhibitor role');
  }

  // TicketType
  let tt = await prisma.ticketType.findFirst({ where: { eventId: event.id, category: 'exhibitor' } });
  if (!tt) {
    tt = await prisma.ticketType.create({
      data: { eventId: event.id, name: 'Exhibitor Booth Pass', category: 'exhibitor', priceCents: 0, status: 'active', maxStaff: 5 },
    });
  }

  // Attendee
  let att = await prisma.attendee.findUnique({ where: { eventId_email: { eventId: event.id, email: DEMO_EMAIL } } });
  if (!att) {
    att = await prisma.attendee.create({
      data: { eventId: event.id, orgId: org.id, email: DEMO_EMAIL, firstName: 'Demo', lastName: 'Exhibitor', company: 'Demo Robotics AG', status: 'confirmed' },
    });
  }

  // Ticket
  let ticket = await prisma.ticket.findFirst({ where: { eventId: event.id, attendeeId: att.id, ticketTypeId: tt.id } });
  if (!ticket) {
    ticket = await prisma.ticket.create({
      data: { eventId: event.id, orgId: org.id, ticketTypeId: tt.id, attendeeId: att.id, code: `DEMO-EX-${randomBytes(6).toString('hex').toUpperCase()}`, status: 'valid' },
    });
  }

  // ExhibitorProfile
  let profile = await prisma.exhibitorProfile.findUnique({ where: { orgId: org.id } });
  if (!profile) {
    profile = await prisma.exhibitorProfile.create({
      data: {
        orgId: org.id, companyName: 'Demo Robotics AG', legalName: 'Demo Robotics AG',
        website: 'https://demo-robotics.example.com',
        description: '<p>Leading provider of collaborative robotic arms for manufacturing and research. Our cobots combine Swiss precision engineering with cutting-edge AI.</p>',
        contactEmail: DEMO_EMAIL, contactPhone: '+41 21 555 0100',
        socialLinks: { linkedin: 'https://linkedin.com/company/demo-robotics', twitter: 'https://twitter.com/demorobotics' },
      },
    });
    console.log(`✔ Created ExhibitorProfile`);
  }

  // EventExhibitor
  let ee = await prisma.eventExhibitor.findUnique({
    where: { eventId_exhibitorProfileId: { eventId: event.id, exhibitorProfileId: profile.id } },
  });
  if (!ee) {
    ee = await prisma.eventExhibitor.create({
      data: {
        eventId: event.id, exhibitorProfileId: profile.id,
        boothNumber: 'A-12', expoArea: 'Hall 1 — Collaborative Robotics',
        exhibitorCategory: 'industry', exhibitorType: 'Premium Exhibitor',
        demoTitle: 'CoBot X3: AI-Powered Pick & Place',
        demoDescription: '<p>Live demo of our CoBot X3 performing high-speed bin-picking with real-time object recognition.</p>',
        status: 'published',
        meta: { buyerName: 'Demo Exhibitor', orderNumber: 'DEMO-001' },
      },
    });
    console.log(`✔ Created EventExhibitor (booth A-12)`);
  }

  // Staff
  const staffCount = await prisma.exhibitorStaff.count({ where: { eventExhibitorId: ee.id } });
  if (staffCount === 0) {
    await prisma.exhibitorStaff.createMany({
      data: [
        { eventExhibitorId: ee.id, firstName: 'Alice', lastName: 'Meier', email: 'alice@demo-robotics.example.com', role: 'booth_manager', passStatus: 'registered' },
        { eventExhibitorId: ee.id, firstName: 'Bruno', lastName: 'Keller', email: 'bruno@demo-robotics.example.com', phone: '+41 79 555 0201', role: 'demo_presenter', passStatus: 'pending' },
      ],
    });
    console.log('✔ Created 2 booth staff');
  }

  // WP mapping
  const wpm = await prisma.wpMapping.findFirst({ where: { sratixEntityType: 'user', sratixEntityId: user.id } });
  if (wpm && wpm.orgId !== org.id) {
    await prisma.wpMapping.update({ where: { id: wpm.id }, data: { orgId: org.id } });
  }

  return { user, org, event, profile };
}

async function main() {
  await seedSuperAdmin();
  await seedDemoExhibitor();

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Accounts Ready');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Super Admin:     ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`);
  console.log(`  Demo Exhibitor:  ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Login:  POST /api/auth/login  { "email": "…", "password": "…" }');
  console.log('');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
