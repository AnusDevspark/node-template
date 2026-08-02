import { z } from 'zod';
import {
  booleanQueryParam,
  emailSchema,
  paginationSchema,
  personNameSchema,
  searchSchema,
  sortingSchema,
  uuidParamSchema,
} from '@/shared/validation/common.schema';
import { PROVIDER_SORT_FIELDS } from '@/modules/provider/provider.repository';

export const providerIdParamSchema = uuidParamSchema;

/**
 * Date of birth.
 *
 * Accepted as YYYY-MM-DD and parsed as UTC midnight. Using `new Date('1985-06-12')`
 * directly is the classic bug: it parses as UTC but is then displayed in local
 * time, so a birthday can shift by a day. Building it explicitly avoids that.
 */
const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date in YYYY-MM-DD format')
  .transform((value, ctx) => {
    const date = new Date(`${value}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'is not a valid date' });
      return z.NEVER;
    }
    if (date.getTime() > Date.now()) {
      ctx.addIssue({ code: 'custom', message: 'cannot be in the future' });
      return z.NEVER;
    }

    return date;
  });

const specialitySchema = z
  .string()
  .trim()
  .min(1, 'speciality is required')
  .max(100, 'speciality must be at most 100 characters');

/**
 * The full list query: pagination + sorting + search + module-specific filters.
 *
 * Composed from the shared pieces rather than a schema factory — `.extend()`
 * keeps the resulting type inferable and the definition readable.
 */
export const listProvidersQuerySchema = paginationSchema
  .extend(sortingSchema(PROVIDER_SORT_FIELDS, 'createdAt').shape)
  .extend(searchSchema.shape)
  .extend({
    isActive: booleanQueryParam.optional(),
    speciality: z.string().trim().max(100).optional(),
  });

/** GET /providers/active: pagination and sorting only, no filters. */
export const listActiveProvidersQuerySchema = paginationSchema.extend(
  sortingSchema(PROVIDER_SORT_FIELDS, 'lastName').shape,
);

export const createProviderSchema = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  dateOfBirth: dateOfBirthSchema,
  email: emailSchema,
  speciality: specialitySchema,
  isActive: z.boolean().optional(),
});

export const updateProviderSchema = z
  .object({
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    dateOfBirth: dateOfBirthSchema.optional(),
    email: emailSchema.optional(),
    speciality: specialitySchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'at least one field must be provided',
  });

/**
 * Bulk import. Capped at 100 because the whole batch runs in one transaction,
 * and a long transaction holds locks and a connection for its full duration.
 */
export const importProvidersSchema = z.object({
  providers: z.array(createProviderSchema).min(1, 'at least one provider is required').max(100),
});

export type ListProvidersQuery = z.infer<typeof listProvidersQuerySchema>;
export type ImportProvidersInput = z.infer<typeof importProvidersSchema>;
export type ListActiveProvidersQuery = z.infer<typeof listActiveProvidersQuerySchema>;
export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;
export type ProviderIdParam = z.infer<typeof providerIdParamSchema>;
