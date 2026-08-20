import { prisma } from '@/database/prisma';
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '@/shared/constants/permissions.constant';
import { ROLES, type RoleName } from '@/shared/constants/roles.constant';

/**
 * Database lifecycle for the integration suite.
 *
 * Reset strategy: TRUNCATE ... RESTART IDENTITY CASCADE, not `deleteMany` and
 * not dropping the schema.
 *
 *   - TRUNCATE is dramatically faster than row-by-row deletes and does not care
 *     about foreign key ordering when CASCADE is used.
 *   - Recreating the schema per test would cost a migration run each time.
 *   - A transaction-per-test that rolls back is faster still, but the app opens
 *     its own transactions (see AuthService.refresh) and nesting them changes
 *     the behaviour being tested.
 *
 * Reference data (roles and permissions) is re-seeded after each truncate,
 * because the application cannot function without it.
 */

/** Every table, in one statement. Add new tables here when the schema grows. */
const TABLES = ['refresh_sessions', 'role_permissions', 'users', 'permissions', 'roles'];

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
  await seedReferenceData();
}

/** Roles and permissions — the minimum the app needs to authorise anything. */
export async function seedReferenceData(): Promise<void> {
  const permissionIds = new Map<string, string>();

  for (const key of ALL_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
    permissionIds.set(key, permission.id);
  }

  for (const roleName of Object.values(ROLES)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    for (const permissionKey of DEFAULT_ROLE_PERMISSIONS[roleName as RoleName]) {
      const permissionId = permissionIds.get(permissionKey);
      if (!permissionId) continue;

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export { prisma };
