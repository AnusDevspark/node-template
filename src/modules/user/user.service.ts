import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@/errors';
import { hashPassword } from '@/shared/utils/password.util';
import { buildPaginationMeta, getPagination } from '@/shared/utils/pagination.util';
import { PERMISSIONS } from '@/shared/constants/permissions.constant';
import type { AuthenticatedUser } from '@/shared/types/authenticated-user.type';
import type { PaginationMeta } from '@/shared/response/response-envelope';
import type { RbacService } from '@/modules/rbac/rbac.service';
import type { UserRepository } from '@/modules/user/user.repository';
import { mapUsersToResponse, mapUserToResponse } from '@/modules/user/user.mapper';
import type { UserResponse } from '@/modules/user/user.types';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from '@/modules/user/user.schema';

/**
 * User business rules.
 *
 * Knows nothing about Express: no Request, no Response, no status codes. It
 * receives plain validated data plus, where a decision depends on who is asking,
 * an AuthenticatedUser. That is what makes it unit-testable against a mocked
 * repository.
 */
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly rbacService: RbacService,
  ) {}

  async listUsers(query: ListUsersQuery): Promise<{ users: UserResponse[]; meta: PaginationMeta }> {
    const pagination = getPagination(query);

    const { items, total } = await this.userRepository.findMany(
      { search: query.search, status: query.status, role: query.role },
      pagination,
      query.sortBy,
      query.sortOrder,
    );

    return {
      users: mapUsersToResponse(items),
      meta: buildPaginationMeta(total, pagination),
    };
  }

  async getUserById(id: string): Promise<UserResponse> {
    const user = await this.userRepository.findById(id);
    if (!user) throw new NotFoundError('User not found');
    return mapUserToResponse(user);
  }

  async createUser(input: CreateUserInput): Promise<UserResponse> {
    // Business rule: emails are unique. Checked here for a clean 409 message;
    // the database unique index is still the real guarantee against a race, and
    // the Prisma error mapper turns that into the same ConflictError.
    const existing = await this.userRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('A user with this email already exists', 'email');
    }

    const roleId = await this.userRepository.findRoleIdByName(input.role);
    if (!roleId) {
      throw new BadRequestError(`Unknown role: ${input.role}`);
    }

    const passwordHash = await hashPassword(input.password);

    // Fields are listed explicitly. The plaintext password never reaches the
    // repository, and no unexpected key from the request can reach Prisma.
    const user = await this.userRepository.create({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      passwordHash,
      roleId,
      ...(input.status ? { status: input.status } : {}),
    });

    return mapUserToResponse(user);
  }

  /**
   * Update, with the ownership rule.
   *
   * Role-based authorization ("may this caller touch the user endpoint at all?")
   * is handled by middleware. Ownership ("may this caller touch *this* user?")
   * cannot be — the middleware does not know which record is being edited, and
   * it should not be loading records. So it lives here, at the top of the
   * operation, which is also where it stays correct if a second entry point is
   * added later.
   */
  async updateUser(
    id: string,
    input: UpdateUserInput,
    actor: AuthenticatedUser,
  ): Promise<UserResponse> {
    const target = await this.userRepository.findById(id);
    if (!target) throw new NotFoundError('User not found');

    const isSelf = actor.id === target.id;
    const canEditOthers = await this.rbacService.hasPermission(actor.role, PERMISSIONS.USER_EDIT);

    if (!isSelf && !canEditOthers) {
      throw new ForbiddenError('You can only modify your own profile');
    }

    // Privilege escalation guard: changing your own role or status is never
    // allowed, no matter what permissions you hold. Without this an ADMIN with
    // USER_EDIT could promote themselves to SUPER_ADMIN.
    if (isSelf && (input.role !== undefined || input.status !== undefined)) {
      throw new ForbiddenError('You cannot change your own role or status');
    }

    if (!canEditOthers && (input.role !== undefined || input.status !== undefined)) {
      throw new ForbiddenError('You do not have permission to change role or status');
    }

    if (input.email && input.email !== target.email) {
      const existing = await this.userRepository.findByEmail(input.email);
      if (existing) {
        throw new ConflictError('A user with this email already exists', 'email');
      }
    }

    let roleId: string | undefined;
    if (input.role) {
      const found = await this.userRepository.findRoleIdByName(input.role);
      if (!found) throw new BadRequestError(`Unknown role: ${input.role}`);
      roleId = found;
    }

    const updated = await this.userRepository.update(id, {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      status: input.status,
      roleId,
    });

    return mapUserToResponse(updated);
  }

  async deleteUser(id: string, actor: AuthenticatedUser): Promise<void> {
    const target = await this.userRepository.findById(id);
    if (!target) throw new NotFoundError('User not found');

    // Deleting yourself locks you out and, for the last admin, locks everyone out.
    if (target.id === actor.id) {
      throw new BadRequestError('You cannot delete your own account');
    }

    // Hard delete. Users are deleted rarely and deliberately, and the cascade on
    // refresh_sessions means every session dies with the account — which is the
    // behaviour you want. If your jurisdiction requires retention, this is the
    // one place to switch to `status: INACTIVE` plus an anonymisation step.
    await this.userRepository.delete(id);
  }

  /** Used by GET /auth/me. Separate from getUserById so the intent reads clearly. */
  async getProfile(userId: string): Promise<UserResponse> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    return mapUserToResponse(user);
  }

  /** Used by the auth module when registering a self-service account. */
  async findDefaultRoleId(roleName: string): Promise<string> {
    const roleId = await this.userRepository.findRoleIdByName(roleName);
    if (!roleId) {
      throw new BadRequestError(
        `Role "${roleName}" does not exist. Run \`npm run prisma:seed\` to create the default roles.`,
      );
    }
    return roleId;
  }
}
