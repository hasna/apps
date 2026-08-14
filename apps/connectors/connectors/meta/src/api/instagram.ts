import type { MetaClient } from './client';
import type {
  InstagramAccount,
  InstagramMedia,
  InstagramMediaListParams,
  PaginatedResponse,
} from '../types';

const DEFAULT_ACCOUNT_FIELDS = [
  'id',
  'ig_id',
  'name',
  'username',
  'biography',
  'followers_count',
  'follows_count',
  'media_count',
  'profile_picture_url',
  'website',
];

const DEFAULT_MEDIA_FIELDS = [
  'id',
  'ig_id',
  'caption',
  'comments_count',
  'is_comment_enabled',
  'like_count',
  'media_product_type',
  'media_type',
  'media_url',
  'owner',
  'permalink',
  'shortcode',
  'thumbnail_url',
  'timestamp',
  'username',
];

/**
 * Meta Instagram API
 * Manage Instagram business accounts and media
 */
export class InstagramApi {
  constructor(private readonly client: MetaClient) {}

  // ============================================
  // Instagram Account Management
  // ============================================

  /**
   * Get Instagram account connected to a Facebook page
   */
  async getAccountForPage(pageId: string, fields?: string[]): Promise<InstagramAccount | null> {
    const result = await this.client.get<{ instagram_business_account?: InstagramAccount }>(`/${pageId}`, {
      fields: `instagram_business_account{${(fields || DEFAULT_ACCOUNT_FIELDS).join(',')}}`,
    });
    return result.instagram_business_account || null;
  }

  /**
   * Get Instagram account by ID
   */
  async get(instagramAccountId: string, fields?: string[]): Promise<InstagramAccount> {
    return this.client.get<InstagramAccount>(`/${instagramAccountId}`, {
      fields: (fields || DEFAULT_ACCOUNT_FIELDS).join(','),
    });
  }

  /**
   * Get Instagram accounts for a business
   */
  async listForBusiness(businessId: string, params?: {
    fields?: string[];
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<InstagramAccount>> {
    const fields = params?.fields || DEFAULT_ACCOUNT_FIELDS;

    return this.client.get<PaginatedResponse<InstagramAccount>>(`/${businessId}/instagram_accounts`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  // ============================================
  // Instagram Media
  // ============================================

  /**
   * List media for an Instagram account
   */
  async listMedia(instagramAccountId: string, params?: InstagramMediaListParams): Promise<PaginatedResponse<InstagramMedia>> {
    const fields = params?.fields || DEFAULT_MEDIA_FIELDS;

    return this.client.get<PaginatedResponse<InstagramMedia>>(`/${instagramAccountId}/media`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    });
  }

  /**
   * Get a specific media item
   */
  async getMedia(mediaId: string, fields?: string[]): Promise<InstagramMedia> {
    return this.client.get<InstagramMedia>(`/${mediaId}`, {
      fields: (fields || DEFAULT_MEDIA_FIELDS).join(','),
    });
  }

  /**
   * Get media children (for carousel posts)
   */
  async getMediaChildren(mediaId: string, fields?: string[]): Promise<PaginatedResponse<InstagramMedia>> {
    const defaultChildFields = ['id', 'media_type', 'media_url', 'timestamp'];

    return this.client.get<PaginatedResponse<InstagramMedia>>(`/${mediaId}/children`, {
      fields: (fields || defaultChildFields).join(','),
    });
  }

  /**
   * Get media comments
   */
  async getMediaComments(mediaId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    text: string;
    timestamp: string;
    username: string;
    like_count?: number;
    replies?: { data: { id: string; text: string; timestamp: string; username: string }[] };
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      text: string;
      timestamp: string;
      username: string;
      like_count?: number;
      replies?: { data: { id: string; text: string; timestamp: string; username: string }[] };
    }>>(`/${mediaId}/comments`, {
      fields: 'id,text,timestamp,username,like_count,replies{id,text,timestamp,username}',
      limit: params?.limit,
      after: params?.after,
    });
  }

  // ============================================
  // Instagram Insights
  // ============================================

  /**
   * Get Instagram account insights
   */
  async getAccountInsights(instagramAccountId: string, params?: {
    metric?: string[];
    period?: 'day' | 'week' | 'days_28' | 'lifetime';
    since?: number;
    until?: number;
  }): Promise<PaginatedResponse<{
    name: string;
    period: string;
    values: { value: number; end_time?: string }[];
    title: string;
    description: string;
    id: string;
  }>> {
    const defaultMetrics = [
      'impressions',
      'reach',
      'profile_views',
      'follower_count',
      'website_clicks',
      'email_contacts',
      'get_directions_clicks',
      'phone_call_clicks',
      'text_message_clicks',
    ];

    return this.client.get<PaginatedResponse<{
      name: string;
      period: string;
      values: { value: number; end_time?: string }[];
      title: string;
      description: string;
      id: string;
    }>>(`/${instagramAccountId}/insights`, {
      metric: (params?.metric || defaultMetrics).join(','),
      period: params?.period || 'day',
      since: params?.since,
      until: params?.until,
    });
  }

  /**
   * Get Instagram media insights
   */
  async getMediaInsights(mediaId: string, params?: {
    metric?: string[];
  }): Promise<PaginatedResponse<{
    name: string;
    period: string;
    values: { value: number }[];
    title: string;
    description: string;
    id: string;
  }>> {
    const defaultMetrics = [
      'engagement',
      'impressions',
      'reach',
      'saved',
    ];

    return this.client.get<PaginatedResponse<{
      name: string;
      period: string;
      values: { value: number }[];
      title: string;
      description: string;
      id: string;
    }>>(`/${mediaId}/insights`, {
      metric: (params?.metric || defaultMetrics).join(','),
    });
  }

  /**
   * Get video/reel specific insights
   */
  async getVideoInsights(mediaId: string): Promise<PaginatedResponse<{
    name: string;
    period: string;
    values: { value: number }[];
    title: string;
    description: string;
    id: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      name: string;
      period: string;
      values: { value: number }[];
      title: string;
      description: string;
      id: string;
    }>>(`/${mediaId}/insights`, {
      metric: 'engagement,impressions,reach,saved,video_views,plays',
    });
  }

  // ============================================
  // Instagram Stories
  // ============================================

  /**
   * Get Instagram stories
   */
  async getStories(instagramAccountId: string, params?: {
    fields?: string[];
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<InstagramMedia>> {
    const defaultFields = [
      'id',
      'media_type',
      'media_url',
      'timestamp',
      'permalink',
    ];

    return this.client.get<PaginatedResponse<InstagramMedia>>(`/${instagramAccountId}/stories`, {
      fields: (params?.fields || defaultFields).join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get story insights
   */
  async getStoryInsights(mediaId: string): Promise<PaginatedResponse<{
    name: string;
    period: string;
    values: { value: number }[];
    title: string;
    description: string;
    id: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      name: string;
      period: string;
      values: { value: number }[];
      title: string;
      description: string;
      id: string;
    }>>(`/${mediaId}/insights`, {
      metric: 'exits,impressions,reach,replies,taps_forward,taps_back',
    });
  }

  // ============================================
  // Instagram Content Publishing
  // ============================================

  /**
   * Create a media container (first step in publishing)
   */
  async createMediaContainer(instagramAccountId: string, params: {
    image_url?: string;
    video_url?: string;
    media_type?: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS' | 'STORIES';
    caption?: string;
    children?: string[];
    cover_url?: string;
    thumb_offset?: number;
    location_id?: string;
    user_tags?: { username: string; x: number; y: number }[];
    product_tags?: { product_id: string; x: number; y: number }[];
    share_to_feed?: boolean;
  }): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      image_url: params.image_url,
      video_url: params.video_url,
      media_type: params.media_type,
      caption: params.caption,
      cover_url: params.cover_url,
      thumb_offset: params.thumb_offset,
      location_id: params.location_id,
      share_to_feed: params.share_to_feed,
    };

    if (params.children) {
      body.children = params.children.join(',');
    }

    if (params.user_tags) {
      body.user_tags = JSON.stringify(params.user_tags);
    }

    if (params.product_tags) {
      body.product_tags = JSON.stringify(params.product_tags);
    }

    return this.client.post<{ id: string }>(`/${instagramAccountId}/media`, body);
  }

  /**
   * Publish a media container (second step in publishing)
   */
  async publishMedia(instagramAccountId: string, creationId: string): Promise<{ id: string }> {
    return this.client.post<{ id: string }>(`/${instagramAccountId}/media_publish`, {
      creation_id: creationId,
    });
  }

  /**
   * Check media container status
   */
  async getMediaContainerStatus(containerId: string): Promise<{
    id: string;
    status_code: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
    status?: string;
  }> {
    return this.client.get<{
      id: string;
      status_code: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
      status?: string;
    }>(`/${containerId}`, {
      fields: 'id,status_code,status',
    });
  }

  // ============================================
  // Instagram Hashtag Search
  // ============================================

  /**
   * Search for a hashtag ID
   */
  async searchHashtag(instagramAccountId: string, hashtag: string): Promise<{ data: { id: string }[] }> {
    return this.client.get<{ data: { id: string }[] }>('/ig_hashtag_search', {
      user_id: instagramAccountId,
      q: hashtag,
    });
  }

  /**
   * Get recent media for a hashtag
   */
  async getHashtagRecentMedia(hashtagId: string, instagramAccountId: string, params?: {
    fields?: string[];
    limit?: number;
  }): Promise<PaginatedResponse<InstagramMedia>> {
    const defaultFields = ['id', 'caption', 'media_type', 'media_url', 'permalink', 'timestamp'];

    return this.client.get<PaginatedResponse<InstagramMedia>>(`/${hashtagId}/recent_media`, {
      user_id: instagramAccountId,
      fields: (params?.fields || defaultFields).join(','),
      limit: params?.limit,
    });
  }

  /**
   * Get top media for a hashtag
   */
  async getHashtagTopMedia(hashtagId: string, instagramAccountId: string, params?: {
    fields?: string[];
    limit?: number;
  }): Promise<PaginatedResponse<InstagramMedia>> {
    const defaultFields = ['id', 'caption', 'media_type', 'media_url', 'permalink', 'timestamp'];

    return this.client.get<PaginatedResponse<InstagramMedia>>(`/${hashtagId}/top_media`, {
      user_id: instagramAccountId,
      fields: (params?.fields || defaultFields).join(','),
      limit: params?.limit,
    });
  }

  // ============================================
  // Instagram Direct Messages (for Business)
  // ============================================

  /**
   * Get Instagram conversations
   */
  async getConversations(instagramAccountId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    participants: { data: { id: string; username: string }[] };
    updated_time: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      participants: { data: { id: string; username: string }[] };
      updated_time: string;
    }>>(`/${instagramAccountId}/conversations`, {
      fields: 'id,participants,updated_time',
      platform: 'instagram',
      limit: params?.limit,
      after: params?.after,
    });
  }
}
