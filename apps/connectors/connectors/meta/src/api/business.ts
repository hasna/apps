import type { MetaClient } from './client';
import type {
  Business,
  BusinessUser,
  BusinessAssetGroup,
  BusinessListParams,
  PaginatedResponse,
} from '../types';

const DEFAULT_BUSINESS_FIELDS = [
  'id',
  'name',
  'created_by',
  'created_time',
  'link',
  'primary_page',
  'profile_picture_uri',
  'timezone_id',
  'two_factor_type',
  'updated_by',
  'updated_time',
  'verification_status',
  'vertical',
];

const DEFAULT_USER_FIELDS = [
  'id',
  'name',
  'business',
  'email',
  'first_name',
  'last_name',
  'role',
  'title',
  'two_fac_status',
];

/**
 * Meta Business Manager API
 * Manage businesses, users, and asset permissions
 */
export class BusinessApi {
  constructor(private readonly client: MetaClient) {}

  // ============================================
  // Business Management
  // ============================================

  /**
   * List businesses the user has access to
   */
  async list(params?: BusinessListParams): Promise<PaginatedResponse<Business>> {
    const fields = params?.fields || DEFAULT_BUSINESS_FIELDS;

    return this.client.get<PaginatedResponse<Business>>('/me/businesses', {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    });
  }

  /**
   * Get a single business by ID
   */
  async get(businessId: string, fields?: string[]): Promise<Business> {
    return this.client.get<Business>(`/${businessId}`, {
      fields: (fields || DEFAULT_BUSINESS_FIELDS).join(','),
    });
  }

  /**
   * Update business information
   */
  async update(businessId: string, params: {
    name?: string;
    vertical?: string;
    primary_page?: string;
    timezone_id?: number;
  }): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/${businessId}`, params as Record<string, unknown>);
  }

  // ============================================
  // Business Users
  // ============================================

  /**
   * List users in a business
   */
  async listUsers(businessId: string, params?: {
    fields?: string[];
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<BusinessUser>> {
    const fields = params?.fields || DEFAULT_USER_FIELDS;

    return this.client.get<PaginatedResponse<BusinessUser>>(`/${businessId}/business_users`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get a business user by ID
   */
  async getUser(userId: string, fields?: string[]): Promise<BusinessUser> {
    return this.client.get<BusinessUser>(`/${userId}`, {
      fields: (fields || DEFAULT_USER_FIELDS).join(','),
    });
  }

  /**
   * Get current user's business user info
   */
  async getCurrentUser(businessId: string): Promise<BusinessUser> {
    const users = await this.listUsers(businessId, { limit: 100 });
    const me = await this.client.get<{ id: string }>('/me', { fields: 'id' });
    const currentUser = users.data.find(u => u.id === me.id);
    if (!currentUser) {
      throw new Error('Current user not found in business');
    }
    return currentUser;
  }

  /**
   * Add user to business
   */
  async addUser(businessId: string, params: {
    email: string;
    role: 'ADMIN' | 'EMPLOYEE' | 'FINANCE_EDITOR' | 'FINANCE_ANALYST' | 'ADS_RIGHTS_REVIEWER' | 'DEVELOPER';
  }): Promise<{ access_status: string; id: string }> {
    return this.client.post<{ access_status: string; id: string }>(`/${businessId}/business_users`, {
      email: params.email,
      role: params.role,
    });
  }

  /**
   * Update user role
   */
  async updateUserRole(userId: string, role: string): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/${userId}`, {
      role,
    });
  }

  /**
   * Remove user from business
   */
  async removeUser(userId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${userId}`);
  }

  /**
   * List pending users
   */
  async listPendingUsers(businessId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    email: string;
    role: string;
    status: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      email: string;
      role: string;
      status: string;
    }>>(`/${businessId}/pending_users`, {
      fields: 'id,email,role,status',
      limit: params?.limit,
      after: params?.after,
    });
  }

  // ============================================
  // System Users
  // ============================================

  /**
   * List system users in a business
   */
  async listSystemUsers(businessId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    name: string;
    role: string;
    created_by?: { id: string; name: string };
    created_time?: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      name: string;
      role: string;
      created_by?: { id: string; name: string };
      created_time?: string;
    }>>(`/${businessId}/system_users`, {
      fields: 'id,name,role,created_by,created_time',
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Create a system user
   */
  async createSystemUser(businessId: string, params: {
    name: string;
    role: 'ADMIN' | 'EMPLOYEE';
  }): Promise<{ id: string; access_token: string }> {
    return this.client.post<{ id: string; access_token: string }>(`/${businessId}/system_users`, params as Record<string, unknown>);
  }

  // ============================================
  // Business Assets
  // ============================================

  /**
   * List ad accounts owned by business
   */
  async listAdAccounts(businessId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    account_id: string;
    name: string;
    account_status: number;
    currency: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      account_id: string;
      name: string;
      account_status: number;
      currency: string;
    }>>(`/${businessId}/owned_ad_accounts`, {
      fields: 'id,account_id,name,account_status,currency',
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * List ad accounts the business has access to (client accounts)
   */
  async listClientAdAccounts(businessId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    account_id: string;
    name: string;
    account_status: number;
    currency: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      account_id: string;
      name: string;
      account_status: number;
      currency: string;
    }>>(`/${businessId}/client_ad_accounts`, {
      fields: 'id,account_id,name,account_status,currency',
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * List pages owned by business
   */
  async listPages(businessId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    name: string;
    category: string;
    link: string;
    verification_status: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      name: string;
      category: string;
      link: string;
      verification_status: string;
    }>>(`/${businessId}/owned_pages`, {
      fields: 'id,name,category,link,verification_status',
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * List pixels owned by business
   */
  async listPixels(businessId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    name: string;
    last_fired_time?: string;
    owner_ad_account?: { id: string; name: string };
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      name: string;
      last_fired_time?: string;
      owner_ad_account?: { id: string; name: string };
    }>>(`/${businessId}/owned_pixels`, {
      fields: 'id,name,last_fired_time,owner_ad_account{id,name}',
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * List Instagram accounts in business
   */
  async listInstagramAccounts(businessId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    username: string;
    name?: string;
    profile_pic?: string;
    followers_count?: number;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      username: string;
      name?: string;
      profile_pic?: string;
      followers_count?: number;
    }>>(`/${businessId}/instagram_accounts`, {
      fields: 'id,username,name,profile_pic,followers_count',
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * List product catalogs in business
   */
  async listCatalogs(businessId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    name: string;
    product_count?: number;
    vertical?: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      name: string;
      product_count?: number;
      vertical?: string;
    }>>(`/${businessId}/owned_product_catalogs`, {
      fields: 'id,name,product_count,vertical',
      limit: params?.limit,
      after: params?.after,
    });
  }

  // ============================================
  // Asset Groups
  // ============================================

  /**
   * List asset groups in a business
   */
  async listAssetGroups(businessId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<BusinessAssetGroup>> {
    return this.client.get<PaginatedResponse<BusinessAssetGroup>>(`/${businessId}/business_asset_groups`, {
      fields: 'id,name',
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Create an asset group
   */
  async createAssetGroup(businessId: string, name: string): Promise<{ id: string }> {
    return this.client.post<{ id: string }>(`/${businessId}/business_asset_groups`, {
      name,
    });
  }

  /**
   * Add assets to a group
   */
  async addAssetsToGroup(assetGroupId: string, params: {
    adaccounts?: string[];
    pages?: string[];
    pixels?: string[];
    instagram_accounts?: string[];
  }): Promise<{ success: boolean }> {
    const body: Record<string, unknown> = {};

    if (params.adaccounts) {
      body.adaccounts = params.adaccounts;
    }
    if (params.pages) {
      body.pages = params.pages;
    }
    if (params.pixels) {
      body.pixels = params.pixels;
    }
    if (params.instagram_accounts) {
      body.instagram_accounts = params.instagram_accounts;
    }

    return this.client.post<{ success: boolean }>(`/${assetGroupId}/assets`, body);
  }

  // ============================================
  // Permissions
  // ============================================

  /**
   * Assign permissions to user for an ad account
   */
  async assignAdAccountPermissions(adAccountId: string, userId: string, tasks: (
    | 'MANAGE'
    | 'ADVERTISE'
    | 'ANALYZE'
  )[]): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/${adAccountId}/assigned_users`, {
      user: userId,
      tasks: tasks,
    });
  }

  /**
   * Assign permissions to user for a page
   */
  async assignPagePermissions(pageId: string, userId: string, tasks: (
    | 'MANAGE'
    | 'CREATE_CONTENT'
    | 'MODERATE'
    | 'ADVERTISE'
    | 'ANALYZE'
    | 'MESSAGING'
  )[]): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/${pageId}/assigned_users`, {
      user: userId,
      tasks: tasks,
    });
  }

  /**
   * Remove permissions from user for an asset
   */
  async removePermissions(assetId: string, userId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${assetId}/assigned_users`, {
      user: userId,
    });
  }

  /**
   * Get users assigned to an asset
   */
  async getAssignedUsers(assetId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    name: string;
    tasks: string[];
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      name: string;
      tasks: string[];
    }>>(`/${assetId}/assigned_users`, {
      fields: 'id,name,tasks',
      limit: params?.limit,
      after: params?.after,
    });
  }
}
