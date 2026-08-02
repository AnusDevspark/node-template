import type { RbacRepository } from '@/modules/rbac/rbac.repository';
import type { PermissionKey } from '@/shared/constants/permissions.constant';

/**
 * Answers "does this role have this permission?".
 *
 * Permissions are resolved per request rather than baked into the JWT, so
 * revoking a permission takes effect immediately instead of at token expiry.
 * That would mean a database round trip on every authorised request, hence the
 * cache below.
 *
 * The cache is a plain in-process Map with a short TTL. Deliberately not Redis:
 * a 60-second window on a table that changes a few times a year is ample, and
 * adding Redis to a starter template for this is not a trade worth making.
 *
 * >>> This is the Redis swap point. <<<
 * With multiple instances each keeps its own copy, so a permission change can
 * take up to TTL seconds to appear everywhere. If that is unacceptable, replace
 * this Map with a shared cache and publish an invalidation event on write.
 */

interface CacheEntry {
  permissions: Set<string>;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

export class RbacService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly rbacRepository: RbacRepository) {}

  async getPermissionsForRole(roleName: string): Promise<Set<string>> {
    const cached = this.cache.get(roleName);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.permissions;
    }

    const keys = await this.rbacRepository.findPermissionKeysByRoleName(roleName);
    const permissions = new Set(keys);

    this.cache.set(roleName, { permissions, expiresAt: Date.now() + CACHE_TTL_MS });
    return permissions;
  }

  async hasPermission(roleName: string, permission: PermissionKey): Promise<boolean> {
    const permissions = await this.getPermissionsForRole(roleName);
    return permissions.has(permission);
  }

  /** True if the role holds at least one of the given permissions. */
  async hasAnyPermission(roleName: string, required: readonly PermissionKey[]): Promise<boolean> {
    if (required.length === 0) return true;
    const permissions = await this.getPermissionsForRole(roleName);
    return required.some((permission) => permissions.has(permission));
  }

  /** True only if the role holds every one of the given permissions. */
  async hasAllPermissions(roleName: string, required: readonly PermissionKey[]): Promise<boolean> {
    if (required.length === 0) return true;
    const permissions = await this.getPermissionsForRole(roleName);
    return required.every((permission) => permissions.has(permission));
  }

  /**
   * Drops cached grants. Call after changing role permissions so the change is
   * visible immediately on this instance.
   */
  invalidate(roleName?: string): void {
    if (roleName) {
      this.cache.delete(roleName);
    } else {
      this.cache.clear();
    }
  }
}
