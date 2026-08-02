/**
 * Input normalisation.
 *
 * Applied only where the normalised form is unambiguously the same value:
 * emails are case-insensitive by spec, and surrounding whitespace in a name is
 * never meaningful. Anything where trimming could change meaning — passwords,
 * free-text notes, search terms used verbatim — is left alone. Silently editing
 * a user's data is worse than rejecting it.
 */

/** Lowercases and trims. Emails are case-insensitive, so this makes lookups reliable. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Trims and collapses internal whitespace runs to a single space. */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Prepares a user-supplied search term. Returns undefined for an empty or
 * whitespace-only term so the caller skips the search clause entirely rather
 * than matching everything.
 */
export function normalizeSearchTerm(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
