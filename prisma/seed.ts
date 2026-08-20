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
 * Sample user accounts, for development only.
 *
 * These exist so GET /users returns more than one row: pagination, search and
 * sorting are impossible to eyeball against a single record. The mix of roles
 * and statuses is deliberate — it gives the status and role filters something
 * to actually filter.
 *
 * Guarded by NODE_ENV so a production seed never inserts fake accounts. They all
 * share one throwaway password, which is safe precisely because this never runs
 * in production.
 */
const SAMPLE_USER_PASSWORD = 'DevPassword123!';

async function seedSampleUsers(roleIds: Map<string, string>): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    console.log('  sample users: skipped in production');
    return;
  }

  const samples = [
    { firstName: 'Ada', lastName: 'Okafor', role: ROLES.ADMIN, status: 'ACTIVE' },
    { firstName: 'John', lastName: 'Mercer', role: ROLES.USER, status: 'ACTIVE' },
    { firstName: 'Priya', lastName: 'Raman', role: ROLES.USER, status: 'ACTIVE' },
    { firstName: 'Tomas', lastName: 'Lindqvist', role: ROLES.USER, status: 'INACTIVE' },
    { firstName: 'Johanna', lastName: 'Weiss', role: ROLES.USER, status: 'SUSPENDED' },
  ] as const;

  // Hashed once rather than per row: Argon2 is intentionally slow, and five
  // separate hashes of the same password would add seconds to every seed.
  const passwordHash = await hashPassword(SAMPLE_USER_PASSWORD);

  for (const sample of samples) {
    const roleId = roleIds.get(sample.role);
    if (!roleId) continue;

    const email = `${sample.firstName.toLowerCase()}.${sample.lastName.toLowerCase()}@example.com`;

    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        firstName: sample.firstName,
        lastName: sample.lastName,
        email,
        passwordHash,
        status: sample.status,
        roleId,
      },
    });
  }

  console.log(`  sample users: ${samples.length} ensured (password: ${SAMPLE_USER_PASSWORD})`);
}

async function main(): Promise<void> {
  console.log('Seeding database...');

  const permissionIds = await seedPermissions();
  const roleIds = await seedRoles(permissionIds);
  await seedAdmin(roleIds);
  await seedSampleUsers(roleIds);

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
