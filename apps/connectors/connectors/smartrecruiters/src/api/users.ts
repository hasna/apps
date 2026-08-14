import type { SmartRecruitersClient } from './client';
import type { User, SmartRecruitersListResponse } from '../types';

export interface ListUsersParams {
  /** Free-text query matched against user name/email */
  q?: string;
  limit?: number;
  offset?: number;
  /** Filter by status, e.g. ACTIVE, INACTIVE, DEACTIVATED */
  status?: string;
}

/**
 * SmartRecruiters Users API (`/users`).
 * Read the users (recruiters, hiring managers, admins) in a company.
 */
export class UsersApi {
  constructor(private readonly client: SmartRecruitersClient) {}

  /** List users in the company. */
  async list(params?: ListUsersParams): Promise<SmartRecruitersListResponse<User>> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.q) queryParams.q = params.q;
    if (params?.limit !== undefined) queryParams.limit = params.limit;
    if (params?.offset !== undefined) queryParams.offset = params.offset;
    if (params?.status) queryParams.status = params.status;

    return this.client.get<SmartRecruitersListResponse<User>>('/users', queryParams);
  }

  /** Get a single user by id. */
  async get(userId: string): Promise<User> {
    return this.client.get<User>(`/users/${encodeURIComponent(userId)}`);
  }
}
