import type {
  SumoLogicConfig,
  SearchJobCreateParams,
  SearchJob,
  SearchJobStatus,
  SearchJobMessagesResponse,
  SearchJobRecordsResponse,
  Collector,
  CollectorsResponse,
  CollectorResponse,
  Source,
  SourcesResponse,
  SourceResponse,
  Dashboard,
  Folder,
  ContentItem,
  ContentPath,
  Monitor,
  MonitorsResponse,
  Role,
  RolesResponse,
  User,
  UsersResponse,
  Partition,
  PartitionsResponse,
  Field,
  FieldsResponse,
} from '../types';
import { SumoLogicClient } from './client';

/**
 * Sumo Logic API wrapper.
 * A thin, typed client over the public Sumo Logic REST API.
 * https://help.sumologic.com/docs/api/
 */
export class SumoLogic {
  private readonly client: SumoLogicClient;

  constructor(config: SumoLogicConfig) {
    this.client = new SumoLogicClient(config);
  }

  /**
   * Create a client from environment variables.
   */
  static fromEnv(): SumoLogic {
    const accessId = process.env.SUMOLOGIC_ACCESS_ID;
    const accessKey = process.env.SUMOLOGIC_ACCESS_KEY;
    const deployment = process.env.SUMOLOGIC_DEPLOYMENT;
    const endpoint = process.env.SUMOLOGIC_ENDPOINT;

    if (!accessId) {
      throw new Error('SUMOLOGIC_ACCESS_ID environment variable is required');
    }
    if (!accessKey) {
      throw new Error('SUMOLOGIC_ACCESS_KEY environment variable is required');
    }
    return new SumoLogic({ accessId, accessKey, deployment, endpoint });
  }

  /**
   * Get a preview of the Access ID (for debugging).
   */
  getAccessIdPreview(): string {
    return this.client.getAccessIdPreview();
  }

  /**
   * Get the underlying client for direct API access.
   */
  getClient(): SumoLogicClient {
    return this.client;
  }

  // ============================================
  // Search Job API (v1)
  // ============================================

  /**
   * Create a search job. Returns the job id used to poll status and fetch results.
   */
  async createSearchJob(params: SearchJobCreateParams): Promise<SearchJob> {
    return this.client.post<SearchJob>('/v1/search/jobs', params as unknown as Record<string, unknown>);
  }

  /**
   * Get the status of a search job.
   */
  async getSearchJobStatus(jobId: string): Promise<SearchJobStatus> {
    return this.client.get<SearchJobStatus>(`/v1/search/jobs/${encodeURIComponent(jobId)}`);
  }

  /**
   * Get raw log messages for a completed (or in-progress) search job.
   */
  async getSearchJobMessages(jobId: string, params: { offset?: number; limit?: number } = {}): Promise<SearchJobMessagesResponse> {
    return this.client.get<SearchJobMessagesResponse>(`/v1/search/jobs/${encodeURIComponent(jobId)}/messages`, {
      offset: params.offset ?? 0,
      limit: params.limit ?? 100,
    });
  }

  /**
   * Get aggregate records for a search job (results of a `| count` style query).
   */
  async getSearchJobRecords(jobId: string, params: { offset?: number; limit?: number } = {}): Promise<SearchJobRecordsResponse> {
    return this.client.get<SearchJobRecordsResponse>(`/v1/search/jobs/${encodeURIComponent(jobId)}/records`, {
      offset: params.offset ?? 0,
      limit: params.limit ?? 100,
    });
  }

  /**
   * Delete/cancel a search job.
   */
  async deleteSearchJob(jobId: string): Promise<void> {
    await this.client.delete(`/v1/search/jobs/${encodeURIComponent(jobId)}`);
  }

  // ============================================
  // Collector Management API (v1)
  // ============================================

  /**
   * List collectors.
   */
  async listCollectors(params?: { limit?: number; offset?: number; filter?: string }): Promise<Collector[]> {
    const result = await this.client.get<CollectorsResponse>('/v1/collectors', params);
    return result.collectors ?? [];
  }

  /**
   * Get a collector by id.
   */
  async getCollector(collectorId: number): Promise<Collector> {
    const result = await this.client.get<CollectorResponse>(`/v1/collectors/${collectorId}`);
    return result.collector;
  }

  /**
   * Delete a collector by id.
   */
  async deleteCollector(collectorId: number): Promise<void> {
    await this.client.delete(`/v1/collectors/${collectorId}`);
  }

  // ============================================
  // Source Management API (v1)
  // ============================================

  /**
   * List sources for a collector.
   */
  async listSources(collectorId: number): Promise<Source[]> {
    const result = await this.client.get<SourcesResponse>(`/v1/collectors/${collectorId}/sources`);
    return result.sources ?? [];
  }

  /**
   * Get a source by id.
   */
  async getSource(collectorId: number, sourceId: number): Promise<Source> {
    const result = await this.client.get<SourceResponse>(`/v1/collectors/${collectorId}/sources/${sourceId}`);
    return result.source;
  }

  // ============================================
  // Dashboard (New) API (v2)
  // ============================================

  /**
   * Get a dashboard by id.
   */
  async getDashboard(dashboardId: string): Promise<Dashboard> {
    return this.client.get<Dashboard>(`/v2/dashboards/${encodeURIComponent(dashboardId)}`);
  }

  // ============================================
  // Content Management API (v2)
  // ============================================

  /**
   * Get a content folder (and its children) by id.
   */
  async getFolder(folderId: string): Promise<Folder> {
    return this.client.get<Folder>(`/v2/content/folders/${encodeURIComponent(folderId)}`);
  }

  /**
   * Get the personal (root) folder for the current user.
   */
  async getPersonalFolder(): Promise<Folder> {
    return this.client.get<Folder>('/v2/content/folders/personal');
  }

  /**
   * Get the full path of a content item by id.
   */
  async getContentPath(contentId: string): Promise<ContentPath> {
    return this.client.get<ContentPath>(`/v2/content/${encodeURIComponent(contentId)}/path`);
  }

  /**
   * Resolve a content item by its path.
   */
  async getContentByPath(path: string): Promise<ContentItem> {
    return this.client.get<ContentItem>('/v2/content/path', { path });
  }

  // ============================================
  // Monitor Management API (v1)
  // ============================================

  /**
   * Get the root monitors folder (top-level monitors/folders).
   */
  async getMonitorsRoot(): Promise<Monitor & MonitorsResponse> {
    return this.client.get<Monitor & MonitorsResponse>('/v1/monitors/root');
  }

  /**
   * Get a monitor or monitor folder by id.
   */
  async getMonitor(monitorId: string): Promise<Monitor> {
    return this.client.get<Monitor>(`/v1/monitors/${encodeURIComponent(monitorId)}`);
  }

  // ============================================
  // Role Management API (v1)
  // ============================================

  /**
   * List roles (token-paginated).
   */
  async listRoles(params?: { limit?: number; token?: string; sortBy?: string; name?: string }): Promise<RolesResponse> {
    return this.client.get<RolesResponse>('/v1/roles', params);
  }

  /**
   * Get a role by id.
   */
  async getRole(roleId: string): Promise<Role> {
    return this.client.get<Role>(`/v1/roles/${encodeURIComponent(roleId)}`);
  }

  // ============================================
  // User Management API (v1)
  // ============================================

  /**
   * List users (token-paginated).
   */
  async listUsers(params?: { limit?: number; token?: string; sortBy?: string; email?: string }): Promise<UsersResponse> {
    return this.client.get<UsersResponse>('/v1/users', params);
  }

  /**
   * Get a user by id.
   */
  async getUser(userId: string): Promise<User> {
    return this.client.get<User>(`/v1/users/${encodeURIComponent(userId)}`);
  }

  // ============================================
  // Partition Management API (v1)
  // ============================================

  /**
   * List partitions (token-paginated).
   */
  async listPartitions(params?: { limit?: number; token?: string }): Promise<PartitionsResponse> {
    return this.client.get<PartitionsResponse>('/v1/partitions', params);
  }

  /**
   * Get a partition by id.
   */
  async getPartition(partitionId: string): Promise<Partition> {
    return this.client.get<Partition>(`/v1/partitions/${encodeURIComponent(partitionId)}`);
  }

  // ============================================
  // Field Management API (v1)
  // ============================================

  /**
   * List custom fields.
   */
  async listFields(): Promise<Field[]> {
    const result = await this.client.get<FieldsResponse>('/v1/fields');
    return result.data ?? [];
  }

  /**
   * Get a field by id.
   */
  async getField(fieldId: string): Promise<Field> {
    return this.client.get<Field>(`/v1/fields/${encodeURIComponent(fieldId)}`);
  }

  // ============================================
  // Validate
  // ============================================

  /**
   * Validate API credentials by making a lightweight authenticated request.
   * Uses the collectors endpoint (limited to one result).
   */
  async validate(): Promise<{ valid: boolean }> {
    await this.client.get<CollectorsResponse>('/v1/collectors', { limit: 1 });
    return { valid: true };
  }
}

export { SumoLogicClient } from './client';
