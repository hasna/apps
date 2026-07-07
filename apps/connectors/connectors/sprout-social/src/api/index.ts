import type {
  SproutSocialConfig,
  Client,
  CustomerProfile,
  Tag,
  Group,
  User,
  Topic,
  Team,
  Queue,
  ListResponse,
  AnalyticsFilter,
  AnalyticsResponse,
  MessageQuery,
  MessageResponse,
  CreatePublishingPostParams,
  PublishingPost,
  PublishingPostResponse,
  CaseQuery,
  CaseResponse,
  MediaUploadParams,
  MediaUploadResponse,
} from '../types';
import { SproutSocialClient } from './client';

/**
 * High-level, customer-scoped wrapper over the Sprout Social API.
 *
 * All customer-scoped endpoints resolve `{customer_id}` from the configured
 * customer id. The `/metadata/client` endpoint is the exception and works with
 * only an access token (use it to discover the customer ids a token can reach).
 */
export class SproutSocial {
  private readonly client: SproutSocialClient;

  constructor(config: SproutSocialConfig) {
    this.client = new SproutSocialClient(config);
  }

  static fromEnv(): SproutSocial {
    const accessToken = process.env.SPROUTSOCIAL_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('SPROUTSOCIAL_ACCESS_TOKEN environment variable is required');
    }
    return new SproutSocial({
      accessToken,
      customerId: process.env.SPROUTSOCIAL_CUSTOMER_ID,
      baseUrl: process.env.SPROUTSOCIAL_BASE_URL,
    });
  }

  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  getCustomerId(): string | undefined {
    return this.client.getCustomerId();
  }

  getClient(): SproutSocialClient {
    return this.client;
  }

  private cid(): string {
    return this.client.requireCustomerId();
  }

  // ============================================
  // Metadata Methods
  // ============================================

  /** Customer ids and names the access token can reach. No customer id needed. */
  async getClientMetadata(): Promise<ListResponse<Client>> {
    return this.client.get<ListResponse<Client>>('/metadata/client');
  }

  /** Social profiles connected to the customer. */
  async getCustomerProfiles(): Promise<ListResponse<CustomerProfile>> {
    return this.client.get<ListResponse<CustomerProfile>>(`/${this.cid()}/metadata/customer`);
  }

  async getTags(): Promise<ListResponse<Tag>> {
    return this.client.get<ListResponse<Tag>>(`/${this.cid()}/metadata/customer/tags`);
  }

  async getGroups(): Promise<ListResponse<Group>> {
    return this.client.get<ListResponse<Group>>(`/${this.cid()}/metadata/customer/groups`);
  }

  async getUsers(): Promise<ListResponse<User>> {
    return this.client.get<ListResponse<User>>(`/${this.cid()}/metadata/customer/users`);
  }

  async getTopics(): Promise<ListResponse<Topic>> {
    return this.client.get<ListResponse<Topic>>(`/${this.cid()}/metadata/customer/topics`);
  }

  async getTeams(): Promise<ListResponse<Team>> {
    return this.client.get<ListResponse<Team>>(`/${this.cid()}/metadata/customer/teams`);
  }

  async getQueues(): Promise<ListResponse<Queue>> {
    return this.client.get<ListResponse<Queue>>(`/${this.cid()}/metadata/customer/queues`);
  }

  // ============================================
  // Analytics Methods
  // ============================================

  private buildAnalyticsBody(query: AnalyticsFilter = {}): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (query.filters) body.filters = query.filters;
    if (query.metrics) body.metrics = query.metrics;
    if (query.fields) body.fields = query.fields;
    if (query.sort) body.sort = query.sort;
    if (query.page !== undefined) body.page = query.page;
    if (query.limit !== undefined) body.limit = query.limit;
    if (query.timezone) body.timezone = query.timezone;
    return body;
  }

  /** Profile-level analytics (day granularity). */
  async getProfileAnalytics(query: AnalyticsFilter = {}): Promise<AnalyticsResponse> {
    return this.client.post<AnalyticsResponse>(`/${this.cid()}/analytics/profiles`, this.buildAnalyticsBody(query));
  }

  /** Post-level analytics with lifetime metrics. */
  async getPostAnalytics(query: AnalyticsFilter = {}): Promise<AnalyticsResponse> {
    return this.client.post<AnalyticsResponse>(`/${this.cid()}/analytics/posts`, this.buildAnalyticsBody(query));
  }

  // ============================================
  // Message / Inbox Methods
  // ============================================

  async getMessages(query: MessageQuery = {}): Promise<MessageResponse> {
    const body: Record<string, unknown> = {};
    if (query.filters) body.filters = query.filters;
    if (query.fields) body.fields = query.fields;
    if (query.metrics) body.metrics = query.metrics;
    if (query.sort) body.sort = query.sort;
    if (query.limit !== undefined) body.limit = query.limit;
    if (query.cursor) body.cursor = query.cursor;
    return this.client.post<MessageResponse>(`/${this.cid()}/messages`, body);
  }

  // ============================================
  // Publishing Methods
  // ============================================

  /**
   * Create a draft post. The public API only permits draft creation, so
   * `is_draft` defaults to true and is forced on.
   */
  async createPost(params: CreatePublishingPostParams): Promise<PublishingPostResponse> {
    const body: Record<string, unknown> = {
      group_id: params.group_id,
      customer_profile_ids: params.customer_profile_ids,
      text: params.text,
      is_draft: params.is_draft ?? true,
    };
    if (params.media) body.media = params.media;
    if (params.tag_ids) body.tag_ids = params.tag_ids;
    if (params.delivery) body.delivery = params.delivery;
    return this.client.post<PublishingPostResponse>(`/${this.cid()}/publishing/posts`, body);
  }

  async getPost(publishingPostId: string): Promise<PublishingPost> {
    return this.client.get<PublishingPost>(
      `/${this.cid()}/publishing/posts/${encodeURIComponent(publishingPostId)}`,
    );
  }

  // ============================================
  // Cases Methods
  // ============================================

  async filterCases(query: CaseQuery = {}): Promise<CaseResponse> {
    const body: Record<string, unknown> = {};
    if (query.filters) body.filters = query.filters;
    if (query.fields) body.fields = query.fields;
    if (query.sort) body.sort = query.sort;
    if (query.limit !== undefined) body.limit = query.limit;
    if (query.cursor) body.cursor = query.cursor;
    return this.client.post<CaseResponse>(`/${this.cid()}/cases/filter`, body);
  }

  // ============================================
  // Media Methods
  // ============================================

  /** Register media by remote URL for Sprout to download. */
  async uploadMediaByUrl(params: MediaUploadParams): Promise<MediaUploadResponse> {
    const body: Record<string, unknown> = {};
    if (params.url) body.url = params.url;
    if (params.alt_text) body.alt_text = params.alt_text;
    return this.client.post<MediaUploadResponse>(`/${this.cid()}/media/`, body);
  }
}

export { SproutSocialClient } from './client';
