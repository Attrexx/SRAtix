/**
 * One-time data migration: convert hardcoded RobotX data to MembershipPartner rows.
 *
 * For each Event that has meta.robotxAccessCode, creates a MembershipPartner
 * entry named "ETH RobotX".  For each TicketType that has robotxDiscount* fields,
 * creates a TicketTypePartnerDiscount row linked to the partner.
 *
 * Run once after the `add-membership-partners` schema migration:
 *   npx ts-node prisma/seed-robotx-to-partners.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Find all events with a robotxAccessCode in meta
  const events = await prisma.event.findMany({
    select: { id: true, meta: true },
  });

  let partnerCount = 0;
  let discountCount = 0;

  for (const event of events) {
    const meta = (event.meta as Record<string, unknown>) ?? {};
    const accessCode = meta.robotxAccessCode as string | undefined;
    if (!accessCode) continue;

    // 2. Upsert a MembershipPartner for this event
    const partner = await prisma.membershipPartner.upsert({
      where: { eventId_slug: { eventId: event.id, slug: 'robotx' } },
      create: {
        eventId: event.id,
        name: 'ETH RobotX',
        slug: 'robotx',
        accessCode,
        sortOrder: 0,
        active: true,
      },
      update: { accessCode }, // update code if partner already exists
    });
    partnerCount++;

    // 3. Find ticket types with RobotX discounts for this event
    const ticketTypes = await prisma.ticketType.findMany({
      where: {
        eventId: event.id,
        robotxDiscountType: { not: null },
        robotxDiscountValue: { not: null },
      },
      select: {
        id: true,
        robotxDiscountType: true,
        robotxDiscountValue: true,
      },
    });

    for (const tt of ticketTypes) {
      if (!tt.robotxDiscountType || tt.robotxDiscountValue == null) continue;

      await prisma.ticketTypePartnerDiscount.upsert({
        where: {
          ticketTypeId_partnerId: {
            ticketTypeId: tt.id,
            partnerId: partner.id,
          },
        },
        create: {
          ticketTypeId: tt.id,
          partnerId: partner.id,
          discountType: tt.robotxDiscountType,
          discountValue: tt.robotxDiscountValue,
        },
        update: {
          discountType: tt.robotxDiscountType,
          discountValue: tt.robotxDiscountValue,
        },
      });
      discountCount++;
    }
  }

  console.log(
    `Migration complete: ${partnerCount} partner(s) created, ${discountCount} discount(s) migrated.`,
  );
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
