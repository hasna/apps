import type { YouTubeClient } from './client';
import type {
  Member,
  MemberListParams,
  MembershipsLevel,
  MembershipsLevelListParams,
  ListResponse,
} from '../types';

export class MembersApi {
  constructor(private readonly client: YouTubeClient) {}

  // ============================================
  // Channel Members
  // ============================================

  /**
   * List channel members (paid memberships)
   * Quota cost: 1 unit per request
   *
   * Note: This requires the channel to have memberships enabled
   */
  async list(params: MemberListParams): Promise<ListResponse<Member>> {
    return this.client.get<ListResponse<Member>>('/members', {
      part: params.part,
      mode: params.mode,
      maxResults: params.maxResults,
      pageToken: params.pageToken,
      hasAccessToLevel: params.hasAccessToLevel,
      filterByMemberChannelId: params.filterByMemberChannelId,
    });
  }

  /**
   * Get all current channel members
   */
  async getAllCurrent(
    maxResults = 1000,
    pageToken?: string,
    parts: string[] = ['snippet']
  ): Promise<ListResponse<Member>> {
    return this.list({
      part: parts,
      mode: 'all_current',
      maxResults,
      pageToken,
    });
  }

  /**
   * Get membership updates (new/cancelled)
   */
  async getUpdates(
    maxResults = 1000,
    pageToken?: string,
    parts: string[] = ['snippet']
  ): Promise<ListResponse<Member>> {
    return this.list({
      part: parts,
      mode: 'updates',
      maxResults,
      pageToken,
    });
  }

  /**
   * Get members with access to a specific level
   */
  async getByLevel(
    levelId: string,
    maxResults = 1000,
    pageToken?: string,
    parts: string[] = ['snippet']
  ): Promise<ListResponse<Member>> {
    return this.list({
      part: parts,
      mode: 'all_current',
      hasAccessToLevel: levelId,
      maxResults,
      pageToken,
    });
  }

  /**
   * Check if a specific channel is a member
   */
  async checkMembership(
    memberChannelId: string,
    parts: string[] = ['snippet']
  ): Promise<Member | null> {
    const response = await this.list({
      part: parts,
      mode: 'all_current',
      filterByMemberChannelId: memberChannelId,
    });
    return response.items[0] || null;
  }

  // ============================================
  // Membership Levels
  // ============================================

  /**
   * List membership levels for a channel
   * Quota cost: 1 unit per request
   */
  async listLevels(params: MembershipsLevelListParams): Promise<ListResponse<MembershipsLevel>> {
    return this.client.get<ListResponse<MembershipsLevel>>('/membershipsLevels', {
      part: params.part,
    });
  }

  /**
   * Get all membership levels
   */
  async getLevels(parts: string[] = ['snippet']): Promise<ListResponse<MembershipsLevel>> {
    return this.listLevels({ part: parts });
  }
}
