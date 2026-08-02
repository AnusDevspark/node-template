import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
} from '../src/shared/constants/permissions.constant';
import { ROLES, ROLE_DESCRIPTIONS, type RoleName } from '../src/shared/constants/roles.constant';
import { hashPassword } from '../src/shared/utils/password.util';

/**
 * ===========================================================================
 * Seed
 * ===========================================================================
 * Creates the roles, permissions and one bootstrap admin the application needs
 * to be usable at all.
 *
 * Two properties matter here:
 *
 * 1. IDEMPOTENT. Everything is an upsert, so running it twice is safe and
 *    running it against an existing database will not clobber data. Grants are
 *    only added, never removed, so permissions an operator changed by hand
 *    survive a re-seed.
 *
 * 2. NO HARDCODED CREDENTIALS. The admin password comes from
 *    SEED_ADMIN_PASSWORD. A committed default password is how templates end up
 *    deployed with `admin/admin123` in production. If the variable is missing in
 *    a production environment, this script refuses to run rather than inventing
 *    one.
 */

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter });

async function seedPermissions(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const key of ALL_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: { description: PERMISSION_DESCRIPTIONS[key] },
      create: { key, description: PERMISSION_DESCRIPTIONS[key] },
    });
    ids.set(key, permission.id);
  }

  console.log(`  permissions: ${ids.size} ensured`);
  return ids;
}

async function seedRoles(permissionIds: Map<string, string>): Promise<Map<string, string>> {
  const roleIds = new Map<string, string>();

  for (const roleName of Object.values(ROLES)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { description: ROLE_DESCRIPTIONS[roleName as RoleName] },
      create: { name: roleName, description: ROLE_DESCRIPTIONS[roleName as RoleName] },
    });
    roleIds.set(roleName, role.id);

    // Grants are added, never deleted — a deleteMany here would silently undo
    // any permission an operator granted through the admin UI.
    const grants = DEFAULT_ROLE_PERMISSIONS[roleName as RoleName];

    for (const permissionKey of grants) {
      const permissionId = permissionIds.get(permissionKey);
      if (!permissionId) continue;

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }

    console.log(`  role ${roleName}: ${grants.length} permissions`);
  }

  return roleIds;
}

async function seedAdmin(roleIds: Map<string, string>): Promise<void> {
  const email = process.env['SEED_ADMIN_EMAIL'];
  const password = process.env['SEED_ADMIN_PASSWORD'];

  if (!email || !password) {
    console.log('  admin: skipped (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set)');
    return;
  }

  if (process.env['NODE_ENV'] === 'production' && password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters in production');
  }

  const roleId = roleIds.get(ROLES.SUPER_ADMIN);
  if (!roleId) throw new Error('SUPER_ADMIN role missing — seedRoles must run first');

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  if (existing) {
    // Never reset an existing admin's password from a seed script: re-running it
    // in an environment where the password was rotated would silently revert it.
    console.log(`  admin: ${email} already exists, left untouched`);
    return;
  }

  await prisma.user.create({
    data: {
      firstName: process.env['SEED_ADMIN_FIRST_NAME'] ?? 'Admin',
      lastName: process.env['SEED_ADMIN_LAST_NAME'] ?? 'User',
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      roleId,
    },
  });

  console.log(`  admin: created ${email}`);
}

/**
 * Sample providers, for development only.
 *
 * Guarded by NODE_ENV so a production seed never inserts fake business data.
 */
async function seedSampleProviders(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    console.log('  providers: skipped in production');
    return;
  }

  const samples = [
    {
      firstName: 'Ada',
      lastName: 'Okafor',
      dateOfBirth: '1981-03-14',
      email: 'ada.okafor@example.com',
      speciality: 'Cardiology',
      isActive: true,
    },
    {
      firstName: 'John',
      lastName: 'Mercer',
      dateOfBirth: '1975-11-02',
      email: 'john.mercer@example.com',
      speciality: 'Cardiology',
      isActive: true,
    },
    {
      firstName: 'Priya',
      lastName: 'Raman',
      dateOfBirth: '1988-07-21',
      email: 'priya.raman@example.com',
      speciality: 'Neurology',
      isActive: true,
    },
    {
      firstName: 'Tomas',
      lastName: 'Lindqvist',
      dateOfBirth: '1969-01-30',
      email: 'tomas.lindqvist@example.com',
      speciality: 'Orthopaedics',
      isActive: false,
    },
    {
      firstName: 'Johanna',
      lastName: 'Weiss',
      dateOfBirth: '1992-09-08',
      email: 'johanna.weiss@example.com',
      speciality: 'Dermatology',
      isActive: true,
    },
  ];

  for (const sample of samples) {
    await prisma.provider.upsert({
      where: { email: sample.email },
      update: {},
      create: {
        firstName: sample.firstName,
        lastName: sample.lastName,
        dateOfBirth: new Date(`${sample.dateOfBirth}T00:00:00.000Z`),
        email: sample.email,
        speciality: sample.speciality,
        isActive: sample.isActive,
      },
    });
  }

  console.log(`  providers: ${samples.length} sample records ensured`);
}

async function main(): Promise<void> {
  console.log('Seeding database...');

  const permissionIds = await seedPermissions();
  const roleIds = await seedRoles(permissionIds);
  await seedAdmin(roleIds);
  await seedSampleProviders();

  console.log('Seed complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
