/** Types the provider module exposes. */

export interface ProviderResponse {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  dateOfBirth: string;
  email: string;
  speciality: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The database record shape, internal to the module. */
export interface ProviderRecord {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  email: string;
  speciality: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Whitelisted create fields. Built by the service, never a raw request body. */
export interface CreateProviderData {
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  email: string;
  speciality: string;
  isActive?: boolean;
}

/** Whitelisted update fields. */
export interface UpdateProviderData {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: Date;
  email?: string;
  speciality?: string;
  isActive?: boolean;
}

/** Whitelisted filters. Anything not named here cannot reach the query. */
export interface ProviderListFilters {
  search?: string;
  isActive?: boolean;
  speciality?: string;
}
