import type { MercuryClient } from './client';
import type {
  Organization,
  User,
  UserListResponse,
  UserRole,
} from '../types';

/**
 * Mercury Organization API
 * Manage organization and users
 */
export class OrganizationApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * Get organization details
   */
  async get(): Promise<Organization> {
    return this.client.get<Organization>('/organization');
  }

  /**
   * Update organization details
   */
  async update(params: Partial<Omit<Organization, 'id' | 'createdAt'>>): Promise<Organization> {
    return this.client.patch<Organization>('/organization', params);
  }

  /**
   * List users in the organization
   */
  async listUsers(params?: { limit?: number; offset?: number; role?: UserRole; status?: 'active' | 'pending' | 'deactivated' }): Promise<UserListResponse> {
    return this.client.get<UserListResponse>('/users', {
      limit: params?.limit,
      offset: params?.offset,
      role: params?.role,
      status: params?.status,
    });
  }

  /**
   * Get a single user
   */
  async getUser(userId: string): Promise<User> {
    return this.client.get<User>(`/users/${userId}`);
  }

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<User> {
    return this.client.get<User>('/users/me');
  }

  /**
   * Invite a new user to the organization
   */
  async inviteUser(params: {
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
  }): Promise<User> {
    return this.client.post<User>('/users/invite', params);
  }

  /**
   * Update a user's role
   */
  async updateUserRole(userId: string, role: UserRole): Promise<User> {
    return this.client.patch<User>(`/users/${userId}`, { role });
  }

  /**
   * Deactivate a user
   */
  async deactivateUser(userId: string): Promise<User> {
    return this.client.patch<User>(`/users/${userId}`, { status: 'deactivated' });
  }

  /**
   * Reactivate a user
   */
  async reactivateUser(userId: string): Promise<User> {
    return this.client.patch<User>(`/users/${userId}`, { status: 'active' });
  }
}
