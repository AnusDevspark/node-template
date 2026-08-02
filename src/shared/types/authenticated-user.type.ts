/**
 * What `req.user` holds after `authenticate` runs.
 *
 * Deliberately small. It is everything a handler needs to make an authorization
 * decision and nothing more — no password hash, no session row, no permission
 * list. Permissions are resolved on demand by RbacService because they change
 * without the token changing.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  /** Role *name*, e.g. "ADMIN". Matches the ROLES constant. */
  role: string;
}
