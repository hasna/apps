import type { TikTokClient } from './client';
import type { BusinessCenter, BusinessCenterMember, BusinessCenterAsset, BusinessCenterRole, PaginatedData } from '../types';

/**
 * TikTok Business Center API
 * Manage Business Center, members, and assets
 */
export class BusinessApi {
  constructor(private readonly client: TikTokClient) {}

  // ============================================
  // Business Center Management
  // ============================================

  /**
   * List Business Centers
   * GET /bc/get/
   */
  async list(params?: {
    filtering?: {
      bc_ids?: string[];
    };
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<BusinessCenter>> {
    return this.client.get<PaginatedData<BusinessCenter>>('/bc/get/', {
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Get Business Center by ID
   */
  async get(bcId: string): Promise<BusinessCenter> {
    const response = await this.list({
      filtering: { bc_ids: [bcId] },
    });
    if (!response.list || response.list.length === 0) {
      throw new Error(`Business Center ${bcId} not found`);
    }
    return response.list[0];
  }

  // ============================================
  // Member Management
  // ============================================

  /**
   * List Business Center members
   * GET /bc/member/get/
   */
  async listMembers(bcId: string, params?: {
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<BusinessCenterMember>> {
    return this.client.get<PaginatedData<BusinessCenterMember>>('/bc/member/get/', {
      bc_id: bcId,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Invite a member to Business Center
   * POST /bc/member/invite/
   */
  async inviteMember(params: {
    bc_id: string;
    email: string;
    role: BusinessCenterRole;
  }): Promise<{ invitation_id: string }> {
    return this.client.post<{ invitation_id: string }>('/bc/member/invite/', params);
  }

  /**
   * Update member role
   * POST /bc/member/update/
   */
  async updateMemberRole(params: {
    bc_id: string;
    user_id: string;
    role: BusinessCenterRole;
  }): Promise<{ bc_id: string; user_id: string }> {
    return this.client.post('/bc/member/update/', params);
  }

  /**
   * Remove member from Business Center
   * POST /bc/member/remove/
   */
  async removeMember(bcId: string, userId: string): Promise<{ bc_id: string; user_id: string }> {
    return this.client.post('/bc/member/remove/', {
      bc_id: bcId,
      user_id: userId,
    });
  }

  // ============================================
  // Asset Management
  // ============================================

  /**
   * List Business Center assets
   * GET /bc/asset/get/
   */
  async listAssets(bcId: string, params?: {
    asset_type?: 'ADVERTISER' | 'CATALOG' | 'PIXEL' | 'TIKTOK_ACCOUNT';
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<BusinessCenterAsset>> {
    return this.client.get<PaginatedData<BusinessCenterAsset>>('/bc/asset/get/', {
      bc_id: bcId,
      asset_type: params?.asset_type,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Add an advertiser asset to Business Center
   * POST /bc/advertiser/add/
   */
  async addAdvertiser(params: {
    bc_id: string;
    advertiser_ids: string[];
  }): Promise<{ bc_id: string; advertiser_ids: string[] }> {
    return this.client.post('/bc/advertiser/add/', params);
  }

  /**
   * Create an advertiser under Business Center
   * POST /bc/advertiser/create/
   */
  async createAdvertiser(params: {
    bc_id: string;
    advertiser_name: string;
    timezone?: string;
    currency?: string;
    company?: string;
    industry?: string;
  }): Promise<{ advertiser_id: string }> {
    return this.client.post<{ advertiser_id: string }>('/bc/advertiser/create/', params);
  }

  /**
   * Get advertisers under Business Center
   * GET /bc/advertiser/get/
   */
  async listAdvertisers(bcId: string, params?: {
    filtering?: {
      advertiser_ids?: string[];
    };
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<{
    advertiser_id: string;
    advertiser_name: string;
    status: string;
    create_time: string;
  }>> {
    return this.client.get('/bc/advertiser/get/', {
      bc_id: bcId,
      filtering: params?.filtering ? JSON.stringify(params.filtering) : undefined,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  // ============================================
  // Partner Management
  // ============================================

  /**
   * List Business Center partners
   * GET /bc/partner/get/
   */
  async listPartners(bcId: string, params?: {
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<{
    partner_bc_id: string;
    partner_bc_name: string;
    partnership_type: string;
    status: string;
    create_time: string;
  }>> {
    return this.client.get('/bc/partner/get/', {
      bc_id: bcId,
      page: params?.page,
      page_size: params?.page_size,
    });
  }

  /**
   * Invite a partner Business Center
   * POST /bc/partner/invite/
   */
  async invitePartner(params: {
    bc_id: string;
    partner_bc_id: string;
    partnership_type: 'AGENCY' | 'ADVERTISER';
  }): Promise<{ invitation_id: string }> {
    return this.client.post<{ invitation_id: string }>('/bc/partner/invite/', params);
  }

  // ============================================
  // Fund Management
  // ============================================

  /**
   * Get Business Center balance
   * GET /bc/balance/get/
   */
  async getBalance(bcId: string): Promise<{
    balance: number;
    cash: number;
    grant: number;
    currency: string;
  }> {
    return this.client.get('/bc/balance/get/', {
      bc_id: bcId,
    });
  }

  /**
   * Transfer funds between BC and advertiser
   * POST /bc/transfer/
   */
  async transfer(params: {
    bc_id: string;
    advertiser_id: string;
    transfer_type: 'BC_TO_ADVERTISER' | 'ADVERTISER_TO_BC';
    amount: number;
  }): Promise<{
    transfer_id: string;
    bc_id: string;
    advertiser_id: string;
    amount: number;
  }> {
    return this.client.post('/bc/transfer/', params);
  }

  /**
   * Get fund transfer history
   * GET /bc/transfer/get/
   */
  async getTransferHistory(bcId: string, params?: {
    advertiser_id?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedData<{
    transfer_id: string;
    bc_id: string;
    advertiser_id: string;
    transfer_type: string;
    amount: number;
    currency: string;
    create_time: string;
  }>> {
    return this.client.get('/bc/transfer/get/', {
      bc_id: bcId,
      advertiser_id: params?.advertiser_id,
      start_date: params?.start_date,
      end_date: params?.end_date,
      page: params?.page,
      page_size: params?.page_size,
    });
  }
}
