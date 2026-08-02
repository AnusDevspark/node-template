import { z } from 'zod';
import { UserStatus } from '@/generated/prisma/enums';
import {
  emailSchema,
  paginationSchema,
  personNameSchema,
  searchSchema,
  sortingSchema,
  uuidParamSchema,
} from '@/shared/validation/common.schema';
import { USER_SORT_FIELDS } from '@/modules/user/user.repository';

/**
 * Validation for the user module. These schemas are the *only* definition of
 * each request shape — controllers derive their types with `z.infer`, and the
 * OpenAPI document is generated from these same objects.
 */

export const userIdParamSchema = uuidParamSchema;

export const listUsersQuerySchema = paginationSchema
  .extend(sortingSchema(USER_SORT_FIELDS, 'createdAt').shape)
  .extend(searchSchema.shape)
  .extend({
    status: z.enum(UserStatus).optional(),
    role: z.string().trim().max(50).optional(),
  });

/**
 * Admin-side user creation. Note what is absent: `passwordHash`, `id`,
 * timestamps. A client cannot set them because they are not in the schema, and
 * Zod strips unknown keys.
 */
export const createUserSchema = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  email: emailSchema,
  password: z
    .string()
    .min(10, 'password must be at least 10 characters')
    .max(128, 'password must be at most 128 characters'),
  role: z.string().trim().min(1).max(50),
  status: z.enum(UserStatus).optional(),
});

/**
 * Partial update. `role` and `status` are accepted here but the service refuses
 * them unless the caller holds USER_EDIT — validation says what is *well formed*,
 * the service says what is *allowed*.
 */
export const updateUserSchema = z
  .object({
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    email: emailSchema.optional(),
    status: z.enum(UserStatus).optional(),
    role: z.string().trim().min(1).max(50).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserIdParam = z.infer<typeof userIdParamSchema>;
