import type { ZendeskClient } from './client';
import type {
  ZendeskUser,
  ZendeskUserResponse,
  ZendeskUsersResponse,
  CreateUserRequest,
  UpdateUserRequest,
  UserListParams,
} from '../types';

/**
 * Zendesk Users API
 * @see https://developer.zendesk.com/api-reference/ticketing/users/users/
 */
export class UsersApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all users
   * @see https://developer.zendesk.com/api-reference/ticketing/users/users/#list-users
   */
  async list(params?: UserListParams): Promise<ZendeskUser[]> {
    const response = await this.client.get<ZendeskUsersResponse>('/users.json', {
      page: params?.page,
      per_page: params?.per_page,
      role: params?.role,
    });
    return response.users;
  }

  /**
   * Get a user by ID
   * @see https://developer.zendesk.com/api-reference/ticketing/users/users/#show-user
   */
  async get(userId: number): Promise<ZendeskUser> {
    const response = await this.client.get<ZendeskUserResponse>(`/users/${userId}.json`);
    return response.user;
  }

  /**
   * Create a new user
   * @see https://developer.zendesk.com/api-reference/ticketing/users/users/#create-user
   */
  async create(data: CreateUserRequest): Promise<ZendeskUser> {
    const response = await this.client.post<ZendeskUserResponse>('/users.json', data);
    return response.user;
  }

  /**
   * Update a user
   * @see https://developer.zendesk.com/api-reference/ticketing/users/users/#update-user
   */
  async update(userId: number, data: UpdateUserRequest): Promise<ZendeskUser> {
    const response = await this.client.put<ZendeskUserResponse>(`/users/${userId}.json`, data);
    return response.user;
  }

  /**
   * Delete a user
   * @see https://developer.zendesk.com/api-reference/ticketing/users/users/#delete-user
   */
  async delete(userId: number): Promise<void> {
    await this.client.delete(`/users/${userId}.json`);
  }

  /**
   * Search users by email
   * @see https://developer.zendesk.com/api-reference/ticketing/users/users/#search-users
   */
  async searchByEmail(email: string): Promise<ZendeskUser[]> {
    const response = await this.client.get<ZendeskUsersResponse>('/users/search.json', {
      query: email,
    });
    return response.users;
  }

  /**
   * Search users by name
   * @see https://developer.zendesk.com/api-reference/ticketing/users/users/#search-users
   */
  async searchByName(name: string): Promise<ZendeskUser[]> {
    const response = await this.client.get<ZendeskUsersResponse>('/users/search.json', {
      query: name,
    });
    return response.users;
  }

  /**
   * List users in an organization
   * @see https://developer.zendesk.com/api-reference/ticketing/users/users/#list-users
   */
  async listByOrganization(organizationId: number, params?: UserListParams): Promise<ZendeskUser[]> {
    const response = await this.client.get<ZendeskUsersResponse>(`/organizations/${organizationId}/users.json`, {
      page: params?.page,
      per_page: params?.per_page,
    });
    return response.users;
  }

  /**
   * Get the currently authenticated user
   * @see https://developer.zendesk.com/api-reference/ticketing/users/users/#show-the-currently-authenticated-user
   */
  async me(): Promise<ZendeskUser> {
    const response = await this.client.get<ZendeskUserResponse>('/users/me.json');
    return response.user;
  }
}
