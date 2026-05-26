import type { CloudflareClient } from './client';
import type { Account, CloudflareResponse } from '../types';

export class AccountsApi {
  constructor(private client: CloudflareClient) {}

  /**
   * List all accounts
   */
  async list(params?: {
    page?: number;
    per_page?: number;
    direction?: 'asc' | 'desc';
    name?: string;
  }): Promise<CloudflareResponse<Account[]>> {
    return this.client.get<Account[]>('/accounts', params);
  }

  /**
   * Get account details
   */
  async get(accountId: string): Promise<Account> {
    const response = await this.client.get<Account>(`/accounts/${accountId}`);
    return response.result;
  }

  /**
   * Update account settings
   */
  async update(accountId: string, settings: {
    name?: string;
    settings?: {
      enforce_twofactor?: boolean;
    };
  }): Promise<Account> {
    const response = await this.client.patch<Account>(`/accounts/${accountId}`, settings);
    return response.result;
  }

  // ============================================
  // Account Members
  // ============================================

  /**
   * List account members
   */
  async listMembers(
    accountId: string,
    params?: {
      page?: number;
      per_page?: number;
      direction?: 'asc' | 'desc';
      order?: 'user.first_name' | 'user.last_name' | 'user.email' | 'status';
      status?: 'accepted' | 'pending' | 'rejected';
    }
  ): Promise<CloudflareResponse<Array<{
    id: string;
    code?: string;
    user: {
      id: string;
      first_name?: string;
      last_name?: string;
      email: string;
      two_factor_authentication_enabled: boolean;
    };
    status: 'accepted' | 'pending' | 'rejected';
    roles: Array<{
      id: string;
      name: string;
      description: string;
      permissions: Record<string, { read: boolean; edit: boolean }>;
    }>;
  }>>> {
    return this.client.get<Array<{
      id: string;
      code?: string;
      user: {
        id: string;
        first_name?: string;
        last_name?: string;
        email: string;
        two_factor_authentication_enabled: boolean;
      };
      status: 'accepted' | 'pending' | 'rejected';
      roles: Array<{
        id: string;
        name: string;
        description: string;
        permissions: Record<string, { read: boolean; edit: boolean }>;
      }>;
    }>>(`/accounts/${accountId}/members`, params);
  }

  /**
   * Get account member details
   */
  async getMember(accountId: string, memberId: string): Promise<{
    id: string;
    user: {
      id: string;
      first_name?: string;
      last_name?: string;
      email: string;
      two_factor_authentication_enabled: boolean;
    };
    status: string;
    roles: Array<{
      id: string;
      name: string;
      description: string;
      permissions: Record<string, { read: boolean; edit: boolean }>;
    }>;
  }> {
    const response = await this.client.get<{
      id: string;
      user: {
        id: string;
        first_name?: string;
        last_name?: string;
        email: string;
        two_factor_authentication_enabled: boolean;
      };
      status: string;
      roles: Array<{
        id: string;
        name: string;
        description: string;
        permissions: Record<string, { read: boolean; edit: boolean }>;
      }>;
    }>(`/accounts/${accountId}/members/${memberId}`);
    return response.result;
  }

  /**
   * Add account member
   */
  async addMember(
    accountId: string,
    params: {
      email: string;
      roles: string[];
      status?: 'accepted' | 'pending';
    }
  ): Promise<{
    id: string;
    user: {
      id: string;
      email: string;
    };
    status: string;
    roles: Array<{ id: string; name: string }>;
  }> {
    const response = await this.client.post<{
      id: string;
      user: {
        id: string;
        email: string;
      };
      status: string;
      roles: Array<{ id: string; name: string }>;
    }>(`/accounts/${accountId}/members`, params);
    return response.result;
  }

  /**
   * Update account member roles
   */
  async updateMember(
    accountId: string,
    memberId: string,
    params: {
      roles: string[];
    }
  ): Promise<{
    id: string;
    roles: Array<{ id: string; name: string }>;
  }> {
    const response = await this.client.put<{
      id: string;
      roles: Array<{ id: string; name: string }>;
    }>(`/accounts/${accountId}/members/${memberId}`, params);
    return response.result;
  }

  /**
   * Remove account member
   */
  async removeMember(accountId: string, memberId: string): Promise<{ id: string }> {
    const response = await this.client.delete<{ id: string }>(`/accounts/${accountId}/members/${memberId}`);
    return response.result;
  }

  // ============================================
  // Account Roles
  // ============================================

  /**
   * List account roles
   */
  async listRoles(accountId: string): Promise<CloudflareResponse<Array<{
    id: string;
    name: string;
    description: string;
    permissions: Record<string, { read: boolean; edit: boolean }>;
  }>>> {
    return this.client.get<Array<{
      id: string;
      name: string;
      description: string;
      permissions: Record<string, { read: boolean; edit: boolean }>;
    }>>(`/accounts/${accountId}/roles`);
  }

  /**
   * Get account role details
   */
  async getRole(accountId: string, roleId: string): Promise<{
    id: string;
    name: string;
    description: string;
    permissions: Record<string, { read: boolean; edit: boolean }>;
  }> {
    const response = await this.client.get<{
      id: string;
      name: string;
      description: string;
      permissions: Record<string, { read: boolean; edit: boolean }>;
    }>(`/accounts/${accountId}/roles/${roleId}`);
    return response.result;
  }

  // ============================================
  // Subscriptions
  // ============================================

  /**
   * List account subscriptions
   */
  async listSubscriptions(accountId: string): Promise<CloudflareResponse<Array<{
    id: string;
    state: string;
    price: number;
    currency: string;
    component_values: Array<{
      name: string;
      value: number;
      default: number;
      price: number;
    }>;
    zone?: {
      id: string;
      name: string;
    };
    frequency: string;
    rate_plan: {
      id: string;
      public_name: string;
      currency: string;
      scope: string;
      externally_managed: boolean;
      sets: string[];
    };
    current_period_end: string;
    current_period_start: string;
  }>>> {
    return this.client.get<Array<{
      id: string;
      state: string;
      price: number;
      currency: string;
      component_values: Array<{
        name: string;
        value: number;
        default: number;
        price: number;
      }>;
      zone?: {
        id: string;
        name: string;
      };
      frequency: string;
      rate_plan: {
        id: string;
        public_name: string;
        currency: string;
        scope: string;
        externally_managed: boolean;
        sets: string[];
      };
      current_period_end: string;
      current_period_start: string;
    }>>(`/accounts/${accountId}/subscriptions`);
  }

  // ============================================
  // User Token Verification
  // ============================================

  /**
   * Verify the current API token
   */
  async verifyToken(): Promise<{
    id: string;
    status: string;
    not_before?: string;
    expires_on?: string;
  }> {
    const response = await this.client.get<{
      id: string;
      status: string;
      not_before?: string;
      expires_on?: string;
    }>('/user/tokens/verify');
    return response.result;
  }

  /**
   * Get user details (for current authenticated user)
   */
  async getUser(): Promise<{
    id: string;
    email: string;
    first_name?: string;
    last_name?: string;
    username: string;
    telephone?: string;
    country?: string;
    zipcode?: string;
    created_on: string;
    modified_on: string;
    two_factor_authentication_enabled: boolean;
    two_factor_authentication_locked: boolean;
    suspended: boolean;
  }> {
    const response = await this.client.get<{
      id: string;
      email: string;
      first_name?: string;
      last_name?: string;
      username: string;
      telephone?: string;
      country?: string;
      zipcode?: string;
      created_on: string;
      modified_on: string;
      two_factor_authentication_enabled: boolean;
      two_factor_authentication_locked: boolean;
      suspended: boolean;
    }>('/user');
    return response.result;
  }
}
