import type { PandaDocClient } from './client';
import type { Member, MemberListResponse } from '../types';

export interface MemberListOptions {
  count?: number;
  page?: number;
}

/**
 * Members API - Manage PandaDoc workspace members
 */
export class MembersApi {
  constructor(private readonly client: PandaDocClient) {}

  /**
   * List workspace members
   */
  async list(options?: MemberListOptions): Promise<MemberListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options) {
      if (options.count) params.count = options.count;
      if (options.page) params.page = options.page;
    }

    return this.client.get<MemberListResponse>('/members', params);
  }

  /**
   * Get member details by membership ID
   */
  async get(membershipId: string): Promise<Member> {
    return this.client.get<Member>(`/members/${membershipId}`);
  }

  /**
   * Get current user details
   */
  async getCurrentUser(): Promise<Member> {
    return this.client.get<Member>('/members/current');
  }
}
