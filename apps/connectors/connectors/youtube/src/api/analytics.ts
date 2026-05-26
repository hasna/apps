import type { YouTubeClient } from './client';
import type {
  AnalyticsReport,
  AnalyticsReportParams,
  AnalyticsGroup,
  AnalyticsGroupItem,
  AnalyticsGroupListParams,
  AnalyticsGroupItemListParams,
  ListResponse,
} from '../types';

export interface AnalyticsGroupInsertParams {
  onBehalfOfContentOwner?: string;
}

export interface AnalyticsGroupItemInsertParams {
  onBehalfOfContentOwner?: string;
}

export class AnalyticsApi {
  constructor(private readonly client: YouTubeClient) {}

  // ============================================
  // Reports
  // ============================================

  /**
   * Query YouTube Analytics reports
   * Quota cost: 1 unit per query
   *
   * Common metrics:
   * - views, estimatedMinutesWatched, averageViewDuration
   * - subscribersGained, subscribersLost
   * - likes, dislikes, comments, shares
   * - estimatedRevenue, adImpressions, cpm
   *
   * Common dimensions:
   * - day, month, video, channel, country, ageGroup, gender
   */
  async query(params: AnalyticsReportParams): Promise<AnalyticsReport> {
    return this.client.get<AnalyticsReport>('/reports', {
      ids: params.ids,
      startDate: params.startDate,
      endDate: params.endDate,
      metrics: params.metrics,
      dimensions: params.dimensions,
      filters: params.filters,
      maxResults: params.maxResults,
      sort: params.sort,
      startIndex: params.startIndex,
      currency: params.currency,
      includeHistoricalChannelData: params.includeHistoricalChannelData,
    }, { useAnalyticsUrl: true });
  }

  /**
   * Get channel analytics
   */
  async getChannelAnalytics(
    channelId: string,
    startDate: string,
    endDate: string,
    metrics: string[] = ['views', 'estimatedMinutesWatched', 'subscribersGained', 'subscribersLost'],
    dimensions?: string[]
  ): Promise<AnalyticsReport> {
    return this.query({
      ids: `channel==${channelId}`,
      startDate,
      endDate,
      metrics: metrics.join(','),
      dimensions: dimensions?.join(','),
    });
  }

  /**
   * Get video analytics
   */
  async getVideoAnalytics(
    videoId: string,
    startDate: string,
    endDate: string,
    metrics: string[] = ['views', 'estimatedMinutesWatched', 'likes', 'comments'],
    dimensions?: string[]
  ): Promise<AnalyticsReport> {
    return this.query({
      ids: `channel==MINE`,
      startDate,
      endDate,
      metrics: metrics.join(','),
      dimensions: dimensions?.join(','),
      filters: `video==${videoId}`,
    });
  }

  /**
   * Get daily views for a channel
   */
  async getDailyViews(
    channelId: string,
    startDate: string,
    endDate: string
  ): Promise<AnalyticsReport> {
    return this.query({
      ids: `channel==${channelId}`,
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched',
      dimensions: 'day',
      sort: 'day',
    });
  }

  /**
   * Get top videos by views
   */
  async getTopVideos(
    channelId: string,
    startDate: string,
    endDate: string,
    maxResults = 10
  ): Promise<AnalyticsReport> {
    return this.query({
      ids: `channel==${channelId}`,
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched,likes,comments',
      dimensions: 'video',
      sort: '-views',
      maxResults,
    });
  }

  /**
   * Get demographics (age and gender)
   */
  async getDemographics(
    channelId: string,
    startDate: string,
    endDate: string
  ): Promise<AnalyticsReport> {
    return this.query({
      ids: `channel==${channelId}`,
      startDate,
      endDate,
      metrics: 'viewerPercentage',
      dimensions: 'ageGroup,gender',
    });
  }

  /**
   * Get geographic distribution
   */
  async getGeographicData(
    channelId: string,
    startDate: string,
    endDate: string,
    maxResults = 25
  ): Promise<AnalyticsReport> {
    return this.query({
      ids: `channel==${channelId}`,
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched',
      dimensions: 'country',
      sort: '-views',
      maxResults,
    });
  }

  /**
   * Get traffic sources
   */
  async getTrafficSources(
    channelId: string,
    startDate: string,
    endDate: string
  ): Promise<AnalyticsReport> {
    return this.query({
      ids: `channel==${channelId}`,
      startDate,
      endDate,
      metrics: 'views,estimatedMinutesWatched',
      dimensions: 'insightTrafficSourceType',
      sort: '-views',
    });
  }

  /**
   * Get revenue data (requires monetization)
   */
  async getRevenue(
    channelId: string,
    startDate: string,
    endDate: string,
    currency = 'USD'
  ): Promise<AnalyticsReport> {
    return this.query({
      ids: `channel==${channelId}`,
      startDate,
      endDate,
      metrics: 'estimatedRevenue,estimatedAdRevenue,estimatedRedPartnerRevenue,grossRevenue,cpm,adImpressions',
      dimensions: 'day',
      sort: 'day',
      currency,
    });
  }

  // ============================================
  // Groups (for organizing content)
  // ============================================

  /**
   * List analytics groups
   * Quota cost: 1 unit
   */
  async listGroups(params: AnalyticsGroupListParams): Promise<ListResponse<AnalyticsGroup>> {
    return this.client.get<ListResponse<AnalyticsGroup>>('/groups', {
      id: params.id,
      mine: params.mine,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      pageToken: params.pageToken,
    }, { useAnalyticsUrl: true });
  }

  /**
   * Get my analytics groups
   */
  async getMyGroups(pageToken?: string): Promise<ListResponse<AnalyticsGroup>> {
    return this.listGroups({
      mine: true,
      pageToken,
    });
  }

  /**
   * Get a group by ID
   */
  async getGroup(groupId: string): Promise<AnalyticsGroup | null> {
    const response = await this.listGroups({ id: groupId });
    return response.items[0] || null;
  }

  /**
   * Insert (create) a group
   * Quota cost: 50 units
   */
  async insertGroup(
    title: string,
    params: AnalyticsGroupInsertParams = {}
  ): Promise<AnalyticsGroup> {
    return this.client.post<AnalyticsGroup>(
      '/groups',
      {
        snippet: {
          title,
        },
      },
      {
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      },
      { useAnalyticsUrl: true }
    );
  }

  /**
   * Update a group
   * Quota cost: 50 units
   */
  async updateGroup(
    groupId: string,
    title: string,
    onBehalfOfContentOwner?: string
  ): Promise<AnalyticsGroup> {
    return this.client.put<AnalyticsGroup>(
      '/groups',
      {
        id: groupId,
        snippet: {
          title,
        },
      },
      {
        onBehalfOfContentOwner,
      }
    );
  }

  /**
   * Delete a group
   * Quota cost: 50 units
   */
  async deleteGroup(groupId: string, onBehalfOfContentOwner?: string): Promise<void> {
    await this.client.delete('/groups', {
      id: groupId,
      onBehalfOfContentOwner,
    });
  }

  // ============================================
  // Group Items
  // ============================================

  /**
   * List group items
   * Quota cost: 1 unit
   */
  async listGroupItems(params: AnalyticsGroupItemListParams): Promise<ListResponse<AnalyticsGroupItem>> {
    return this.client.get<ListResponse<AnalyticsGroupItem>>('/groupItems', {
      groupId: params.groupId,
      onBehalfOfContentOwner: params.onBehalfOfContentOwner,
    }, { useAnalyticsUrl: true });
  }

  /**
   * Get items in a group
   */
  async getGroupItems(groupId: string): Promise<ListResponse<AnalyticsGroupItem>> {
    return this.listGroupItems({ groupId });
  }

  /**
   * Insert (add) an item to a group
   * Quota cost: 50 units
   */
  async insertGroupItem(
    groupId: string,
    resourceId: string,
    resourceKind: 'youtube#video' | 'youtube#channel' | 'youtube#playlist' = 'youtube#video',
    params: AnalyticsGroupItemInsertParams = {}
  ): Promise<AnalyticsGroupItem> {
    return this.client.post<AnalyticsGroupItem>(
      '/groupItems',
      {
        groupId,
        resource: {
          kind: resourceKind,
          id: resourceId,
        },
      },
      {
        onBehalfOfContentOwner: params.onBehalfOfContentOwner,
      },
      { useAnalyticsUrl: true }
    );
  }

  /**
   * Add a video to a group
   */
  async addVideoToGroup(groupId: string, videoId: string): Promise<AnalyticsGroupItem> {
    return this.insertGroupItem(groupId, videoId, 'youtube#video');
  }

  /**
   * Delete a group item
   * Quota cost: 50 units
   */
  async deleteGroupItem(itemId: string, onBehalfOfContentOwner?: string): Promise<void> {
    await this.client.delete('/groupItems', {
      id: itemId,
      onBehalfOfContentOwner,
    });
  }
}
