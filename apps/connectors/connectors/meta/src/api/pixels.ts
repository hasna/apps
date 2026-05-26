import type { MetaClient } from './client';
import type {
  Pixel,
  PixelListParams,
  ConversionsApiEvent,
  ConversionsApiResponse,
  PaginatedResponse,
} from '../types';
import { formatAdAccountId } from '../utils/config';

const DEFAULT_FIELDS = [
  'id',
  'name',
  'code',
  'creation_time',
  'creator',
  'data_use_setting',
  'enable_automatic_matching',
  'first_party_cookie_status',
  'is_created_by_business',
  'is_crm',
  'is_unavailable',
  'last_fired_time',
  'owner_ad_account',
  'owner_business',
];

/**
 * Meta Pixels API
 * Manage Facebook Pixels and Conversions API (CAPI)
 */
export class PixelsApi {
  constructor(private readonly client: MetaClient) {}

  // ============================================
  // Pixel Management
  // ============================================

  /**
   * List pixels for an ad account
   */
  async list(adAccountId: string, params?: PixelListParams): Promise<PaginatedResponse<Pixel>> {
    const formattedId = formatAdAccountId(adAccountId);
    const fields = params?.fields || DEFAULT_FIELDS;

    return this.client.get<PaginatedResponse<Pixel>>(`/${formattedId}/adspixels`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    });
  }

  /**
   * List pixels for a business
   */
  async listForBusiness(businessId: string, params?: PixelListParams): Promise<PaginatedResponse<Pixel>> {
    const fields = params?.fields || DEFAULT_FIELDS;

    return this.client.get<PaginatedResponse<Pixel>>(`/${businessId}/owned_pixels`, {
      fields: fields.join(','),
      limit: params?.limit,
      after: params?.after,
      before: params?.before,
    });
  }

  /**
   * Get a single pixel by ID
   */
  async get(pixelId: string, fields?: string[]): Promise<Pixel> {
    return this.client.get<Pixel>(`/${pixelId}`, {
      fields: (fields || DEFAULT_FIELDS).join(','),
    });
  }

  /**
   * Create a new pixel
   */
  async create(adAccountId: string, name: string): Promise<{ id: string }> {
    const formattedId = formatAdAccountId(adAccountId);
    return this.client.post<{ id: string }>(`/${formattedId}/adspixels`, {
      name,
    });
  }

  /**
   * Update pixel settings
   */
  async update(pixelId: string, params: {
    name?: string;
    enable_automatic_matching?: boolean;
    automatic_matching_fields?: string[];
    first_party_cookie_status?: 'EMPTY' | 'FIRST_PARTY_COOKIE_ENABLED' | 'FIRST_PARTY_COOKIE_DISABLED';
  }): Promise<{ success: boolean }> {
    const body: Record<string, unknown> = {
      name: params.name,
      enable_automatic_matching: params.enable_automatic_matching,
      first_party_cookie_status: params.first_party_cookie_status,
    };

    if (params.automatic_matching_fields) {
      body.automatic_matching_fields = JSON.stringify(params.automatic_matching_fields);
    }

    return this.client.post<{ success: boolean }>(`/${pixelId}`, body);
  }

  /**
   * Get pixel code snippet
   */
  async getCode(pixelId: string): Promise<Pixel> {
    return this.client.get<Pixel>(`/${pixelId}`, {
      fields: 'code',
    });
  }

  // ============================================
  // Conversions API (CAPI)
  // ============================================

  /**
   * Send events via Conversions API
   */
  async sendEvents(pixelId: string, events: ConversionsApiEvent[], options?: {
    test_event_code?: string;
    partner_agent?: string;
    namespace_id?: string;
    upload_id?: string;
    upload_tag?: string;
    upload_source?: string;
  }): Promise<ConversionsApiResponse> {
    const body: Record<string, unknown> = {
      data: JSON.stringify(events),
    };

    if (options?.test_event_code) {
      body.test_event_code = options.test_event_code;
    }

    if (options?.partner_agent) {
      body.partner_agent = options.partner_agent;
    }

    if (options?.namespace_id) {
      body.namespace_id = options.namespace_id;
    }

    if (options?.upload_id) {
      body.upload_id = options.upload_id;
    }

    if (options?.upload_tag) {
      body.upload_tag = options.upload_tag;
    }

    if (options?.upload_source) {
      body.upload_source = options.upload_source;
    }

    return this.client.post<ConversionsApiResponse>(`/${pixelId}/events`, body);
  }

  /**
   * Send a single event via Conversions API
   */
  async sendEvent(pixelId: string, event: ConversionsApiEvent, testEventCode?: string): Promise<ConversionsApiResponse> {
    return this.sendEvents(pixelId, [event], { test_event_code: testEventCode });
  }

  /**
   * Create a standard event
   */
  createEvent(params: {
    eventName: string;
    eventTime?: number;
    eventId?: string;
    eventSourceUrl?: string;
    actionSource: ConversionsApiEvent['action_source'];
    userData: {
      email?: string;
      phone?: string;
      firstName?: string;
      lastName?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
      externalId?: string;
      clientIpAddress?: string;
      clientUserAgent?: string;
      fbc?: string;
      fbp?: string;
    };
    customData?: {
      value?: number;
      currency?: string;
      contentName?: string;
      contentCategory?: string;
      contentIds?: string[];
      contentType?: 'product' | 'product_group';
      orderId?: string;
      numItems?: number;
      searchString?: string;
    };
  }): ConversionsApiEvent {
    const event: ConversionsApiEvent = {
      event_name: params.eventName,
      event_time: params.eventTime || Math.floor(Date.now() / 1000),
      event_id: params.eventId,
      event_source_url: params.eventSourceUrl,
      action_source: params.actionSource,
      user_data: {},
    };

    // Map user data fields (these should be hashed for production)
    if (params.userData.email) event.user_data.em = params.userData.email;
    if (params.userData.phone) event.user_data.ph = params.userData.phone;
    if (params.userData.firstName) event.user_data.fn = params.userData.firstName;
    if (params.userData.lastName) event.user_data.ln = params.userData.lastName;
    if (params.userData.city) event.user_data.ct = params.userData.city;
    if (params.userData.state) event.user_data.st = params.userData.state;
    if (params.userData.zip) event.user_data.zp = params.userData.zip;
    if (params.userData.country) event.user_data.country = params.userData.country;
    if (params.userData.externalId) event.user_data.external_id = params.userData.externalId;
    if (params.userData.clientIpAddress) event.user_data.client_ip_address = params.userData.clientIpAddress;
    if (params.userData.clientUserAgent) event.user_data.client_user_agent = params.userData.clientUserAgent;
    if (params.userData.fbc) event.user_data.fbc = params.userData.fbc;
    if (params.userData.fbp) event.user_data.fbp = params.userData.fbp;

    // Map custom data
    if (params.customData) {
      event.custom_data = {
        value: params.customData.value,
        currency: params.customData.currency,
        content_name: params.customData.contentName,
        content_category: params.customData.contentCategory,
        content_ids: params.customData.contentIds,
        content_type: params.customData.contentType,
        order_id: params.customData.orderId,
        num_items: params.customData.numItems,
        search_string: params.customData.searchString,
      };
    }

    return event;
  }

  // ============================================
  // Pixel Stats & Diagnostics
  // ============================================

  /**
   * Get pixel stats
   */
  async getStats(pixelId: string, params?: {
    event?: string;
    start_time?: number;
    end_time?: number;
    aggregation?: 'event' | 'device' | 'url';
  }): Promise<PaginatedResponse<{
    timestamp: string;
    event: string;
    count: number;
  }>> {
    return this.client.get<PaginatedResponse<{
      timestamp: string;
      event: string;
      count: number;
    }>>(`/${pixelId}/stats`, {
      event: params?.event,
      start_time: params?.start_time,
      end_time: params?.end_time,
      aggregation: params?.aggregation || 'event',
    });
  }

  /**
   * Get pixel recent events (for debugging)
   */
  async getRecentEvents(pixelId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    event_name: string;
    event_time: string;
    event_source_url?: string;
    custom_data?: Record<string, unknown>;
  }>> {
    return this.client.get<PaginatedResponse<{
      event_name: string;
      event_time: string;
      event_source_url?: string;
      custom_data?: Record<string, unknown>;
    }>>(`/${pixelId}/recent_events`, {
      limit: params?.limit,
      after: params?.after,
    });
  }

  /**
   * Get data sources stats (diagnostic quality)
   */
  async getDataSourcesStats(pixelId: string): Promise<{
    data: {
      event_name: string;
      total_count: number;
      total_matched_count: number;
      match_rate: number;
    }[];
  }> {
    return this.client.get<{
      data: {
        event_name: string;
        total_count: number;
        total_matched_count: number;
        match_rate: number;
      }[];
    }>(`/${pixelId}/da_checks`);
  }

  // ============================================
  // Pixel Audiences
  // ============================================

  /**
   * Get custom audiences using this pixel
   */
  async getAudiences(pixelId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{
    id: string;
    name: string;
    subtype: string;
    approximate_count_lower_bound?: number;
    approximate_count_upper_bound?: number;
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      name: string;
      subtype: string;
      approximate_count_lower_bound?: number;
      approximate_count_upper_bound?: number;
    }>>(`/${pixelId}/audiences`, {
      fields: 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound',
      limit: params?.limit,
      after: params?.after,
    });
  }

  // ============================================
  // Pixel Sharing
  // ============================================

  /**
   * Share pixel with an ad account
   */
  async shareWithAdAccount(pixelId: string, adAccountId: string): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/${pixelId}/shared_accounts`, {
      account_id: formatAdAccountId(adAccountId),
    });
  }

  /**
   * Share pixel with a business
   */
  async shareWithBusiness(pixelId: string, businessId: string): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(`/${pixelId}/agencies`, {
      business: businessId,
    });
  }

  /**
   * List ad accounts with access to pixel
   */
  async getSharedAdAccounts(pixelId: string, params?: {
    limit?: number;
    after?: string;
  }): Promise<PaginatedResponse<{ id: string; name: string; account_id: string }>> {
    return this.client.get<PaginatedResponse<{ id: string; name: string; account_id: string }>>(`/${pixelId}/shared_accounts`, {
      fields: 'id,name,account_id',
      limit: params?.limit,
      after: params?.after,
    });
  }

  // ============================================
  // Event Source Groups
  // ============================================

  /**
   * Get event source groups for a pixel
   */
  async getEventSourceGroups(pixelId: string): Promise<PaginatedResponse<{
    id: string;
    name: string;
    event_sources: { id: string; name: string; source_type: string }[];
  }>> {
    return this.client.get<PaginatedResponse<{
      id: string;
      name: string;
      event_sources: { id: string; name: string; source_type: string }[];
    }>>(`/${pixelId}/event_source_groups`, {
      fields: 'id,name,event_sources{id,name,source_type}',
    });
  }
}
