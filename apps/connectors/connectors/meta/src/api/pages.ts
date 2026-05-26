import type { MetaClient } from './client';
import type {
  Page,
  PageListParams,
  PaginatedResponse,
} from '../types';

const DEFAULT_FIELDS = [
  'id',
  'name',
  'about',
  'category',
  'category_list',
  'cover',
  'description',
  'emails',
  'fan_count',
  'followers_count',
  'link',
  'location',
  'phone',
  'picture',
  'single_line_address',
  'username',
  'verification_status',
  'website',
  'is_published',
];

/**
 * Meta Pages API
 * Manage Facebook pages and page content
 */
export class PagesApi {
  constructor(private readonly client: MetaClient) {}

  /**
   * List pages the user has access to
   */
  async list(params?: PageListParams): Promise<PaginatedResponse<Page>> {
    const fields = params?.fields || DEFAULT_FIELDS;

    return this.client.get<PaginatedResponse<Page>>('/me/accounts', {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    });
  }

  /**
   * Get a single page by ID
   */
  async get(pageId: string, fields?: string[]): Promise<Page> {
    return this.client.get<Page>(`/${pageId}`, {
      fields: (fields || DEFAULT_FIELDS).join(','),
    });
  }

  /**
   * Get page access token (for posting as page)
   */
  async getAccessToken(pageId: string): Promise<{ access_token: string; id: string }> {
    return this.client.get<{ access_token: string; id: string }>(`/${pageId}`, {
      fields: 'access_token,id',
    });
  }

  /**
   * Get pages owned by a business
   */
  async listForBusiness(businessId: string, params?: PageListParams): Promise<PaginatedResponse<Page>> {
    const fields = params?.fields || DEFAULT_FIELDS;

    return this.client.get<PaginatedResponse<Page>>(`/${businessId}/owned_pages`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    });
  }

  /**
   * Get page insights
   */
  async getInsights(pageId: string, params?: {
    metric?: string[];
    period?: 'day' | 'week' | 'days_28' | 'month' | 'lifetime' | 'total_over_range';
    since?: string;
    until?: string;
  }): Promise<PaginatedResponse<{
    name: string;
    period: string;
    values: { value: number | Record<string, number>; end_time?: string }[];
    title: string;
    description: string;
    id: string;
  }>> {
    const defaultMetrics = [
      'page_impressions',
      'page_impressions_unique',
      'page_engaged_users',
      'page_post_engagements',
      'page_fan_adds',
      'page_fan_removes',
      'page_views_total',
    ];

    return this.client.get<PaginatedResponse<{
      name: string;
      period: string;
      values: { value: number | Record<string, number>; end_time?: string }[];
      title: string;
      description: string;
      id: string;
    }>>(`/${pageId}/insights`, {
      metric: (params?.metric || defaultMetrics).join(','),
      period: params?.period || 'day',
      since: params?.since,
      until: params?.until,
    });
  }

  /**
   * Get page posts
   */
  async getPosts(pageId: string, params?: {
    fields?: string[];
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    message?: string;
    created_time: string;
    permalink_url?: string;
    shares?: { count: number };
    reactions?: { summary: { total_count: number } };
    comments?: { summary: { total_count: number } };
  }>> {
    const defaultFields = [
      'id',
      'message',
      'created_time',
      'permalink_url',
      'shares',
      'reactions.summary(true)',
      'comments.summary(true)',
    ];

    return this.client.get<PaginatedResponse<{
      id: string;
      message?: string;
      created_time: string;
      permalink_url?: string;
      shares?: { count: number };
      reactions?: { summary: { total_count: number } };
      comments?: { summary: { total_count: number } };
    }>>(`/${pageId}/posts`, {
      fields: (params?.fields || defaultFields).join(','),
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Create a page post
   */
  async createPost(pageId: string, params: {
    message?: string;
    link?: string;
    published?: boolean;
    scheduled_publish_time?: number;
  }, pageAccessToken?: string): Promise<{ id: string }> {
    // If a page access token is provided, we need to use it
    // This would require modifying the client or using a different approach
    // For now, we'll use the user token and rely on proper permissions

    return this.client.post<{ id: string }>(`/${pageId}/feed`, params as Record<string, unknown>);
  }

  /**
   * Delete a page post
   */
  async deletePost(postId: string): Promise<{ success: boolean }> {
    return this.client.delete<{ success: boolean }>(`/${postId}`);
  }

  /**
   * Get page photos
   */
  async getPhotos(pageId: string, params?: {
    type?: 'uploaded' | 'tagged';
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    created_time: string;
    name?: string;
    link?: string;
    picture?: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      created_time: string;
      name?: string;
      link?: string;
      picture?: string;
    }>>(`/${pageId}/photos`, {
      type: params?.type || 'uploaded',
      fields: 'id,created_time,name,link,picture',
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get page videos
   */
  async getVideos(pageId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    created_time: string;
    title?: string;
    description?: string;
    length?: number;
    permalink_url?: string;
    picture?: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      created_time: string;
      title?: string;
      description?: string;
      length?: number;
      permalink_url?: string;
      picture?: string;
    }>>(`/${pageId}/videos`, {
      fields: 'id,created_time,title,description,length,permalink_url,picture',
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get page events
   */
  async getEvents(pageId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    name: string;
    description?: string;
    start_time: string;
    end_time?: string;
    place?: { name: string; location?: { city?: string; country?: string } };
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      name: string;
      description?: string;
      start_time: string;
      end_time?: string;
      place?: { name: string; location?: { city?: string; country?: string } };
    }>>(`/${pageId}/events`, {
      fields: 'id,name,description,start_time,end_time,place',
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get page ratings/reviews
   */
  async getRatings(pageId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    reviewer: { id: string; name: string };
    rating?: number;
    review_text?: string;
    created_time: string;
  }>> {
    return this.client.get<PaginatedResponse<{
      reviewer: { id: string; name: string };
      rating?: number;
      review_text?: string;
      created_time: string;
    }>>(`/${pageId}/ratings`, {
      fields: 'reviewer,rating,review_text,created_time',
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get Instagram account connected to page
   */
  async getInstagramAccount(pageId: string): Promise<{ instagram_business_account?: { id: string } }> {
    return this.client.get<{ instagram_business_account?: { id: string } }>(`/${pageId}`, {
      fields: 'instagram_business_account',
    });
  }

  /**
   * Get page conversations (for messaging)
   */
  async getConversations(pageId: string, params?: {
    folder?: 'inbox' | 'other' | 'spam';
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    updated_time: string;
    participants: { data: { id: string; name: string; email?: string }[] };
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      updated_time: string;
      participants: { data: { id: string; name: string; email?: string }[] };
    }>>(`/${pageId}/conversations`, {
      fields: 'id,updated_time,participants',
      folder: params?.folder,
      limit: params?.limit,
      after: params?.after,
    });
  }
}
