import type { YouTubeClient } from './client';
import type {
  LiveBroadcast,
  LiveBroadcastListParams,
  LiveStream,
  LiveStreamListParams,
  LiveChatMessage,
  LiveChatMessageListParams,
  LiveChatMessageListResponse,
  LiveChatBan,
  LiveChatModerator,
  ListResponse,
} from '../types';

export interface LiveBroadcastInsertParams {
  part: string[];
  onBehalfOfContentOwner?: string;
  onBehalfOfContentOwnerChannel?: string;
}

export interface LiveBroadcastUpdateParams {
  part: string[];
  onBehalfOfContentOwner?: string;
}

export interface LiveStreamInsertParams {
  part: string[];
  onBehalfOfContentOwner?: string;
  onBehalfOfContentOwnerChannel?: string;
}

export interface LiveStreamUpdateParams {
  part: string[];
  onBehalfOfContentOwner?: string;
}

export class LiveApi {
  constructor(private readonly client: YouTubeClient) {}

  // ============================================
  // Live Broadcasts
  // ============================================

  /**
   * List live broadcasts
   * Quota cost: 5 units per request
   */
  async listBroadcasts(params: LiveBroadcastListParams): Promise<ListResponse<LiveBroadcast>> {
    return this.client.get<ListResponse<LiveBroadcast>>('/liveBroadcasts', {
      part: params.part,
      broadcastStatus: params.broadcastStatus,
      broadcastType: params.broadcastType,
      id: params.id,
      mine: params.mine,
      maxResults: params.maxResults,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      onBehalfOfContentOwnerChannel: params.onBehalfOfContentOwnerChannel,
      pageToken: params.pageToken,
    });
  }

  /**
   * Get my live broadcasts
   */
  async getMyBroadcasts(
    status?: 'active' | 'all' | 'completed' | 'upcoming',
    maxResults = 25,
    parts: string[] = ['snippet', 'contentDetails', 'status']
  ): Promise<ListResponse<LiveBroadcast>> {
    return this.listBroadcasts({
      part: parts,
      mine: true,
      broadcastStatus: status,
      maxResults,
    });
  }

  /**
   * Get a live broadcast by ID
   */
  async getBroadcast(
    broadcastId: string,
    parts: string[] = ['snippet', 'contentDetails', 'status']
  ): Promise<LiveBroadcast | null> {
    const response = await this.listBroadcasts({
      part: parts,
      id: broadcastId,
    });
    return response.items[0] || null;
  }

  /**
   * Insert (create) a live broadcast
   * Quota cost: 50 units
   */
  async insertBroadcast(
    broadcast: Omit<LiveBroadcast, 'kind' | 'etag' | 'id'>,
    params: LiveBroadcastInsertParams
  ): Promise<LiveBroadcast> {
    return this.client.post<LiveBroadcast>(
      '/liveBroadcasts',
      broadcast as Record<string, unknown>,
      {
        part: params.part,
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
        onBehalfOfContentOwnerChannel: params.onBehalfOfContentOwnerChannel,
      }
    );
  }

  /**
   * Create a new live broadcast
   */
  async createBroadcast(
    title: string,
    scheduledStartTime: string,
    privacyStatus: 'private' | 'public' | 'unlisted' = 'private',
    description?: string
  ): Promise<LiveBroadcast> {
    return this.insertBroadcast(
      {
        snippet: {
          title,
          description: description || '',
          scheduledStartTime,
        },
        status: {
          privacyStatus,
        },
      } as Omit<LiveBroadcast, 'kind' | 'etag' | 'id'>,
      { part: ['snippet', 'status'] }
    );
  }

  /**
   * Update a live broadcast
   * Quota cost: 50 units
   */
  async updateBroadcast(
    broadcast: Partial<LiveBroadcast> & { id: string },
    params: LiveBroadcastUpdateParams
  ): Promise<LiveBroadcast> {
    return this.client.put<LiveBroadcast>(
      '/liveBroadcasts',
      broadcast as Record<string, unknown>,
      {
        part: params.part,
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      }
    );
  }

  /**
   * Delete a live broadcast
   * Quota cost: 50 units
   */
  async deleteBroadcast(
    broadcastId: string,
    onBehalfOfContentOwner?: string
  ): Promise<void> {
    await this.client.delete('/liveBroadcasts', {
      id: broadcastId,
      onBehalfOfContentOwner,
    });
  }

  /**
   * Bind a broadcast to a stream
   * Quota cost: 50 units
   */
  async bindBroadcast(
    broadcastId: string,
    streamId: string,
    parts: string[] = ['snippet', 'contentDetails', 'status'],
    onBehalfOfContentOwner?: string
  ): Promise<LiveBroadcast> {
    return this.client.post<LiveBroadcast>('/liveBroadcasts/bind', undefined, {
      id: broadcastId,
      streamId,
      part: parts,
      onBehalfOfContentOwner,
    });
  }

  /**
   * Transition a broadcast to a new status
   * Quota cost: 50 units
   */
  async transitionBroadcast(
    broadcastId: string,
    broadcastStatus: 'complete' | 'live' | 'testing',
    parts: string[] = ['snippet', 'contentDetails', 'status'],
    onBehalfOfContentOwner?: string
  ): Promise<LiveBroadcast> {
    return this.client.post<LiveBroadcast>('/liveBroadcasts/transition', undefined, {
      id: broadcastId,
      broadcastStatus,
      part: parts,
      onBehalfOfContentOwner,
    });
  }

  // ============================================
  // Live Streams
  // ============================================

  /**
   * List live streams
   * Quota cost: 5 units per request
   */
  async listStreams(params: LiveStreamListParams): Promise<ListResponse<LiveStream>> {
    return this.client.get<ListResponse<LiveStream>>('/liveStreams', {
      part: params.part,
      id: params.id,
      mine: params.mine,
      maxResults: params.maxResults,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      onBehalfOfContentOwnerChannel: params.onBehalfOfContentOwnerChannel,
      pageToken: params.pageToken,
    });
  }

  /**
   * Get my live streams
   */
  async getMyStreams(
    maxResults = 25,
    parts: string[] = ['snippet', 'cdn', 'contentDetails', 'status']
  ): Promise<ListResponse<LiveStream>> {
    return this.listStreams({
      part: parts,
      mine: true,
      maxResults,
    });
  }

  /**
   * Get a live stream by ID
   */
  async getStream(
    streamId: string,
    parts: string[] = ['snippet', 'cdn', 'contentDetails', 'status']
  ): Promise<LiveStream | null> {
    const response = await this.listStreams({
      part: parts,
      id: streamId,
    });
    return response.items[0] || null;
  }

  /**
   * Insert (create) a live stream
   * Quota cost: 50 units
   */
  async insertStream(
    stream: Omit<LiveStream, 'kind' | 'etag' | 'id'>,
    params: LiveStreamInsertParams
  ): Promise<LiveStream> {
    return this.client.post<LiveStream>(
      '/liveStreams',
      stream as Record<string, unknown>,
      {
        part: params.part,
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
        onBehalfOfContentOwnerChannel: params.onBehalfOfContentOwnerChannel,
      }
    );
  }

  /**
   * Create a new live stream
   */
  async createStream(
    title: string,
    resolution: string = '1080p',
    frameRate: string = '30fps',
    ingestionType: 'rtmp' | 'dash' | 'webrtc' | 'hls' = 'rtmp'
  ): Promise<LiveStream> {
    return this.insertStream(
      {
        snippet: {
          title,
        },
        cdn: {
          ingestionType,
          resolution,
          frameRate,
        },
      } as Omit<LiveStream, 'kind' | 'etag' | 'id'>,
      { part: ['snippet', 'cdn'] }
    );
  }

  /**
   * Update a live stream
   * Quota cost: 50 units
   */
  async updateStream(
    stream: Partial<LiveStream> & { id: string },
    params: LiveStreamUpdateParams
  ): Promise<LiveStream> {
    return this.client.put<LiveStream>(
      '/liveStreams',
      stream as Record<string, unknown>,
      {
        part: params.part,
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      }
    );
  }

  /**
   * Delete a live stream
   * Quota cost: 50 units
   */
  async deleteStream(
    streamId: string,
    onBehalfOfContentOwner?: string
  ): Promise<void> {
    await this.client.delete('/liveStreams', {
      id: streamId,
      onBehalfOfContentOwner,
    });
  }

  // ============================================
  // Live Chat Messages
  // ============================================

  /**
   * List live chat messages
   * Quota cost: 5 units per request
   */
  async listChatMessages(params: LiveChatMessageListParams): Promise<LiveChatMessageListResponse> {
    return this.client.get<LiveChatMessageListResponse>('/liveChat/messages', {
      liveChatId: params.liveChatId,
      part: params.part,
      hl: params.hl,
      maxResults: params.maxResults,
      pageToken: params.pageToken,
      profileImageSize: params.profileImageSize,
    });
  }

  /**
   * Get chat messages for a live chat
   */
  async getChatMessages(
    liveChatId: string,
    maxResults = 200,
    pageToken?: string
  ): Promise<LiveChatMessageListResponse> {
    return this.listChatMessages({
      liveChatId,
      part: ['snippet', 'authorDetails'],
      maxResults,
      pageToken,
    });
  }

  /**
   * Send a chat message
   * Quota cost: 200 units
   */
  async sendChatMessage(
    liveChatId: string,
    messageText: string
  ): Promise<LiveChatMessage> {
    return this.client.post<LiveChatMessage>(
      '/liveChat/messages',
      {
        snippet: {
          liveChatId,
          type: 'textMessageEvent',
          textMessageDetails: {
            messageText,
          },
        },
      },
      { part: ['snippet'] }
    );
  }

  /**
   * Delete a chat message
   * Quota cost: 50 units
   */
  async deleteChatMessage(messageId: string): Promise<void> {
    await this.client.delete('/liveChat/messages', { id: messageId });
  }

  // ============================================
  // Live Chat Bans
  // ============================================

  /**
   * Ban a user from live chat
   * Quota cost: 50 units
   */
  async banUser(
    liveChatId: string,
    channelId: string,
    type: 'permanent' | 'temporary' = 'permanent',
    banDurationSeconds?: number
  ): Promise<LiveChatBan> {
    return this.client.post<LiveChatBan>(
      '/liveChat/bans',
      {
        snippet: {
          liveChatId,
          type,
          banDurationSeconds: banDurationSeconds ? String(banDurationSeconds) : undefined,
          bannedUserDetails: {
            channelId,
          },
        },
      },
      { part: ['snippet'] }
    );
  }

  /**
   * Unban a user from live chat
   * Quota cost: 50 units
   */
  async unbanUser(banId: string): Promise<void> {
    await this.client.delete('/liveChat/bans', { id: banId });
  }

  // ============================================
  // Live Chat Moderators
  // ============================================

  /**
   * List live chat moderators
   * Quota cost: 5 units per request
   */
  async listModerators(
    liveChatId: string,
    maxResults = 25,
    pageToken?: string
  ): Promise<ListResponse<LiveChatModerator>> {
    return this.client.get<ListResponse<LiveChatModerator>>('/liveChat/moderators', {
      liveChatId,
      part: ['snippet'],
      maxResults,
      pageToken,
    });
  }

  /**
   * Add a moderator to live chat
   * Quota cost: 50 units
   */
  async addModerator(
    liveChatId: string,
    channelId: string
  ): Promise<LiveChatModerator> {
    return this.client.post<LiveChatModerator>(
      '/liveChat/moderators',
      {
        snippet: {
          liveChatId,
          moderatorDetails: {
            channelId,
          },
        },
      },
      { part: ['snippet'] }
    );
  }

  /**
   * Remove a moderator from live chat
   * Quota cost: 50 units
   */
  async removeModerator(moderatorId: string): Promise<void> {
    await this.client.delete('/liveChat/moderators', { id: moderatorId });
  }
}
