import type { ProviderRecord, ProviderResponse } from '@/modules/provider/provider.types';

/**
 * Database entity → API DTO.
 *
 * Provider has no secret columns today, so this mapper mostly normalises types:
 * Date objects become ISO strings, and `fullName` is derived once rather than in
 * every client. It still exists, and is still field-by-field, because the moment
 * someone adds an internal column (a cost rate, an external vendor id) the safe
 * behaviour is already in place. Returning the Prisma record directly is the
 * habit that leaks it.
 *
 * dateOfBirth is a `@db.Date` column, so only the calendar date is meaningful —
 * it is serialised as YYYY-MM-DD rather than a full timestamp to avoid implying
 * a time and timezone that were never stored.
 */
export function mapProviderToResponse(provider: ProviderRecord): ProviderResponse {
  return {
    id: provider.id,
    firstName: provider.firstName,
    lastName: provider.lastName,
    fullName: `${provider.firstName} ${provider.lastName}`,
    dateOfBirth: toDateOnly(provider.dateOfBirth),
    email: provider.email,
    speciality: provider.speciality,
    isActive: provider.isActive,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

export function mapProvidersToResponse(providers: ProviderRecord[]): ProviderResponse[] {
  return providers.map(mapProviderToResponse);
}

/** YYYY-MM-DD in UTC, matching how the value was stored. */
function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
