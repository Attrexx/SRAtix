/**
 * Seed script — creates the Super Admin account.
 *
 * Usage:  npx ts-node --transpile-only prisma/seed.ts
 *
 * Idempotent — skips if the email already exists.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const email = 'attrexx@gmail.com';
  const displayName = 'Super Admin';
  // Generate a random 20-char password (alphanumeric + dash + underscore)
  const password = randomBytes(15)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 20);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`✔ Super Admin already exists (${existing.id})`);

    // Ensure they have the super_admin role
    const hasRole = await prisma.userRole.findFirst({
      where: { userId: existing.id, role: 'super_admin' },
    });
    if (!hasRole) {
      await prisma.userRole.create({
        data: { userId: existing.id, role: 'super_admin' },
      });
      console.log('  → Added super_admin role');
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      displayName,
      passwordHash,
      emailConfirmedAt: new Date(),
      active: true,
    },
  });

  await prisma.userRole.create({
    data: {
      userId: user.id,
      role: 'super_admin',
    },
  });

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('  SRAtix Super Admin Account Created');
  console.log('═══════════════════════════════════════════');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log(`  User ID:  ${user.id}`);
  console.log('');
  console.log('  ⚠  Save this password NOW — it cannot be recovered.');
  console.log('     You can change it later from the Dashboard.');
  console.log('═══════════════════════════════════════════');
  console.log('');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
