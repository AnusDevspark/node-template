import type { Request, Response } from 'express';
import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from '@/shared/response/send-response.util';
import { requireAuthenticatedUser } from '@/shared/utils/auth-context.util';
import type { UserService } from '@/modules/user/user.service';
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateUserInput,
  UserIdParam,
} from '@/modules/user/user.schema';

/**
 * HTTP only. Each method reads already-validated input, calls one service
 * method, and sends a response. No business rules, no Prisma, no try/catch —
 * Express 5 forwards a rejected promise to the error handler on its own.
 */
export class UserController {
  constructor(private readonly userService: UserService) {}

  // Arrow properties so the methods can be passed as route handlers without
  // losing `this`. The alternative is `.bind(this)` at every route.

  listUsers = async (req: Request, res: Response): Promise<void> => {
    const query = req.query as unknown as ListUsersQuery;
    const { users, meta } = await this.userService.listUsers(query);
    sendPaginated(res, users, meta);
  };

  getUser = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as UserIdParam;
    const user = await this.userService.getUserById(id);
    sendSuccess(res, user);
  };

  createUser = async (req: Request, res: Response): Promise<void> => {
    const input = req.body as CreateUserInput;
    const user = await this.userService.createUser(input);
    sendCreated(res, user, 'User created successfully.');
  };

  updateUser = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as UserIdParam;
    const input = req.body as UpdateUserInput;
    // The ownership decision belongs to the service, so pass it the actor
    // rather than deciding here.
    const actor = requireAuthenticatedUser(req);
    const user = await this.userService.updateUser(id, input, actor);
    sendSuccess(res, user, 'User updated successfully.');
  };

  deleteUser = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as UserIdParam;
    const actor = requireAuthenticatedUser(req);
    await this.userService.deleteUser(id, actor);
    sendNoContent(res);
  };
}
