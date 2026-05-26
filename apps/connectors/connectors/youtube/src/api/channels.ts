import type { YouTubeClient } from './client';
import type {
  Channel,
  ChannelSection,
  ChannelBrandingSettings,
  ListResponse,
} from '../types';

export interface ChannelListParams {
  part: string[];
  categoryId?: string;
  forHandle?: string;
  forUsername?: string;
  hl?: string;
  id?: string | string[];
  managedByMe?: boolean;
  maxResults?: number;
  mine?: boolean;
  onBehalfOfContentOwner?: string;
  pageToken?: string;
}

export interface ChannelUpdateParams {
  part: string[];
  onBehalfOfContentOwner?: string;
}

export interface ChannelSectionListParams {
  part: string[];
  channelId?: string;
  hl?: string;
  id?: string | string[];
  mine?: boolean;
  onBehalfOfContentOwner?: string;
}

export class ChannelsApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * List channels
   * Quota cost: 1 unit per request + 2 units per result for snippet,contentDetails,statistics
   */
  async list(params: ChannelListParams): Promise<ListResponse<Channel>> {
    return this.client.get<ListResponse<Channel>>('/channels', {
      part: params.part,
      categoryId: params.categoryId,
      forHandle: params.forHandle,
      forUsername: params.forUsername,
      hl: params.hl,
      id: params.id,
      managedByMe: params.managedByMe,
      maxResults: params.maxResults,
      mine: params.mine,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      pageToken: params.pageToken,
    });
  }

  /**
   * Get a single channel by ID
   */
  async get(channelId: string, parts: string[] = ['snippet', 'contentDetails', 'statistics']): Promise<Channel | null> {
    const response = await this.list({ part: parts, id: channelId });
    return response.items[0] || null;
  }

  /**
   * Get the authenticated user's channel
   */
  async getMine(parts: string[] = ['snippet', 'contentDetails', 'statistics']): Promise<Channel | null> {
    const response = await this.list({ part: parts, mine: true });
    return response.items[0] || null;
  }

  /**
   * Update a channel
   * Quota cost: 50 units
   */
  async update(channel: Partial<Channel> & { id: string }, params: ChannelUpdateParams): Promise<Channel> {
    return this.client.put<Channel>('/channels', channel as Record<string, unknown>, {
      part: params.part,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
    });
  }

  /**
   * Update channel branding settings
   */
  async updateBranding(channelId: string, brandingSettings: ChannelBrandingSettings): Promise<Channel> {
    return this.update(
      { id: channelId, brandingSettings },
      { part: ['brandingSettings'] }
    );
  }

  /**
   * List channel sections
   * Quota cost: 1 unit
   */
  async listSections(params: ChannelSectionListParams): Promise<ListResponse<ChannelSection>> {
    return this.client.get<ListResponse<ChannelSection>>('/channelSections', {
      part: params.part,
      channelId: params.channelId,
      hl: params.hl,
      id: params.id,
      mine: params.mine,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
    });
  }

  /**
   * Insert a channel section
   * Quota cost: 50 units
   */
  async insertSection(
    section: Omit<ChannelSection, 'kind' | 'etag' | 'id'>,
    parts: string[] = ['snippet', 'contentDetails']
  ): Promise<ChannelSection> {
    return this.client.post<ChannelSection>(
      '/channelSections',
      section as Record<string, unknown>,
      { part: parts }
    );
  }

  /**
   * Update a channel section
   * Quota cost: 50 units
   */
  async updateSection(
    section: Partial<ChannelSection> & { id: string },
    parts: string[] = ['snippet', 'contentDetails']
  ): Promise<ChannelSection> {
    return this.client.put<ChannelSection>(
      '/channelSections',
      section as Record<string, unknown>,
      { part: parts }
    );
  }

  /**
   * Delete a channel section
   * Quota cost: 50 units
   */
  async deleteSection(sectionId: string): Promise<void> {
    await this.client.delete('/channelSections', { id: sectionId });
  }
}
