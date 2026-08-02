import type { PrismaClientInstance } from '@/database/prisma';
import { withPrismaErrors } from '@/shared/utils/prisma-error-mapper.util';

/**
 * Reads role → permission grants. Persistence only; the caching and the
 * "does this user have X" question belong to RbacService.
 */
export class RbacRepository {
  constructor(private readonly prisma: PrismaClientInstance) {}

  /** Permission keys granted to a role name. Empty array if the role is unknown. */
  async findPermissionKeysByRoleName(roleName: string): Promise<string[]> {
    return withPrismaErrors('Role', async () => {
      const role = await this.prisma.role.findUnique({
        where: { name: roleName },
        select: {
          permissions: {
            select: { permission: { select: { key: true } } },
          },
        },
      });

      if (!role) return [];
      return role.permissions.map((rolePermission) => rolePermission.permission.key);
    });
  }

  async roleExists(roleName: string): Promise<boolean> {
    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
      select: { id: true },
    });
    return role !== null;
  }
}
