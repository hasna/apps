import type {
  SplunkCloudConfig,
  SplunkCollection,
  ServerInfo,
  SearchJobContent,
  CreateSearchJobParams,
  SearchResults,
  JobControlAction,
  SavedSearchContent,
  CreateSavedSearchParams,
  UpdateSavedSearchParams,
  IndexContent,
  CreateIndexParams,
  HecTokenContent,
  CreateHecTokenParams,
  UserContent,
  CreateUserParams,
  RoleContent,
  MessageContent,
  FiredAlertContent,
  AppContent,
} from '../types';
import { SplunkCloudClient } from './client';

export interface ListParams {
  count?: number;
  offset?: number;
  search?: string;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
}

function listToParams(params?: ListParams): Record<string, string | number | boolean | undefined> {
  if (!params) return {};
  return {
    count: params.count,
    offset: params.offset,
    search: params.search,
    sort_key: params.sortKey,
    sort_dir: params.sortDir,
  };
}

/**
 * High-level Splunk Cloud Platform API. Wraps the splunkd REST endpoints
 * (/services/*) with typed helpers.
 */
export class SplunkCloud {
  private readonly client: SplunkCloudClient;

  constructor(config: SplunkCloudConfig) {
    this.client = new SplunkCloudClient(config);
  }

  static fromEnv(): SplunkCloud {
    const baseUrl = process.env.SPLUNK_CLOUD_BASE_URL;
    if (!baseUrl) {
      throw new Error('SPLUNK_CLOUD_BASE_URL environment variable is required');
    }

    const token = process.env.SPLUNK_CLOUD_TOKEN;
    const username = process.env.SPLUNK_CLOUD_USERNAME;
    const password = process.env.SPLUNK_CLOUD_PASSWORD;

    if (!token && !(username && password)) {
      throw new Error(
        'Authentication required: set SPLUNK_CLOUD_TOKEN or SPLUNK_CLOUD_USERNAME and SPLUNK_CLOUD_PASSWORD',
      );
    }

    return new SplunkCloud({ baseUrl, token, username, password });
  }

  getClient(): SplunkCloudClient {
    return this.client;
  }

  getKeyPreview(): string {
    return this.client.getKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  // ============================================
  // Server info / health
  // ============================================

  async getServerInfo(): Promise<ServerInfo> {
    const res = await this.client.get<SplunkCollection<ServerInfo>>('/services/server/info');
    return res.entry?.[0]?.content ?? {};
  }

  async getHealth(): Promise<SplunkCollection> {
    return this.client.get<SplunkCollection>('/services/server/health/splunkd');
  }

  // ============================================
  // Search jobs
  // ============================================

  async listSearchJobs(params?: ListParams): Promise<SplunkCollection<SearchJobContent>> {
    return this.client.get<SplunkCollection<SearchJobContent>>('/services/search/jobs', listToParams(params));
  }

  async createSearchJob(params: CreateSearchJobParams): Promise<{ sid: string }> {
    const search = /^\s*(search|\||search\s)/i.test(params.search) ? params.search : `search ${params.search}`;
    const body: Record<string, string | number | boolean | undefined> = {
      search,
      earliest_time: params.earliestTime,
      latest_time: params.latestTime,
      exec_mode: params.execMode ?? 'normal',
      max_count: params.maxCount,
      ...params.extra,
    };
    const res = await this.client.post<{ sid: string }>('/services/search/jobs', body);
    return res;
  }

  async getSearchJob(sid: string): Promise<SearchJobContent> {
    const res = await this.client.get<SplunkCollection<SearchJobContent>>(
      `/services/search/jobs/${encodeURIComponent(sid)}`,
    );
    return res.entry?.[0]?.content ?? {};
  }

  async getSearchResults(
    sid: string,
    params?: { count?: number; offset?: number; fieldList?: string },
  ): Promise<SearchResults> {
    return this.client.get<SearchResults>(`/services/search/jobs/${encodeURIComponent(sid)}/results`, {
      count: params?.count,
      offset: params?.offset,
      f: params?.fieldList,
    });
  }

  async controlSearchJob(sid: string, action: JobControlAction): Promise<SplunkCollection<MessageContent>> {
    return this.client.post<SplunkCollection<MessageContent>>(
      `/services/search/jobs/${encodeURIComponent(sid)}/control`,
      { action },
    );
  }

  async pauseSearchJob(sid: string): Promise<SplunkCollection<MessageContent>> {
    return this.controlSearchJob(sid, 'pause');
  }

  async unpauseSearchJob(sid: string): Promise<SplunkCollection<MessageContent>> {
    return this.controlSearchJob(sid, 'unpause');
  }

  async finalizeSearchJob(sid: string): Promise<SplunkCollection<MessageContent>> {
    return this.controlSearchJob(sid, 'finalize');
  }

  async deleteSearchJob(sid: string): Promise<SplunkCollection<MessageContent>> {
    return this.client.delete<SplunkCollection<MessageContent>>(
      `/services/search/jobs/${encodeURIComponent(sid)}`,
    );
  }

  // ============================================
  // Saved searches
  // ============================================

  async listSavedSearches(params?: ListParams): Promise<SplunkCollection<SavedSearchContent>> {
    return this.client.get<SplunkCollection<SavedSearchContent>>('/services/saved/searches', listToParams(params));
  }

  async getSavedSearch(name: string): Promise<SavedSearchContent> {
    const res = await this.client.get<SplunkCollection<SavedSearchContent>>(
      `/services/saved/searches/${encodeURIComponent(name)}`,
    );
    return res.entry?.[0]?.content ?? {};
  }

  async createSavedSearch(params: CreateSavedSearchParams): Promise<SplunkCollection<SavedSearchContent>> {
    const body: Record<string, string | number | boolean | undefined> = {
      name: params.name,
      search: params.search,
      description: params.description,
      cron_schedule: params.cronSchedule,
      is_scheduled: params.isScheduled,
      'dispatch.earliest_time': params.earliestTime,
      'dispatch.latest_time': params.latestTime,
      ...params.extra,
    };
    return this.client.post<SplunkCollection<SavedSearchContent>>('/services/saved/searches', body);
  }

  async updateSavedSearch(
    name: string,
    params: UpdateSavedSearchParams,
  ): Promise<SplunkCollection<SavedSearchContent>> {
    const body: Record<string, string | number | boolean | undefined> = {
      search: params.search,
      description: params.description,
      cron_schedule: params.cronSchedule,
      is_scheduled: params.isScheduled,
      disabled: params.disabled,
      'dispatch.earliest_time': params.earliestTime,
      'dispatch.latest_time': params.latestTime,
      ...params.extra,
    };
    return this.client.post<SplunkCollection<SavedSearchContent>>(
      `/services/saved/searches/${encodeURIComponent(name)}`,
      body,
    );
  }

  async deleteSavedSearch(name: string): Promise<SplunkCollection> {
    return this.client.delete<SplunkCollection>(`/services/saved/searches/${encodeURIComponent(name)}`);
  }

  // ============================================
  // Indexes
  // ============================================

  async listIndexes(params?: ListParams): Promise<SplunkCollection<IndexContent>> {
    return this.client.get<SplunkCollection<IndexContent>>('/services/data/indexes', listToParams(params));
  }

  async getIndex(name: string): Promise<IndexContent> {
    const res = await this.client.get<SplunkCollection<IndexContent>>(
      `/services/data/indexes/${encodeURIComponent(name)}`,
    );
    return res.entry?.[0]?.content ?? {};
  }

  async createIndex(params: CreateIndexParams): Promise<SplunkCollection<IndexContent>> {
    const body: Record<string, string | number | boolean | undefined> = {
      name: params.name,
      maxTotalDataSizeMB: params.maxTotalDataSizeMB,
      frozenTimePeriodInSecs: params.frozenTimePeriodInSecs,
      datatype: params.datatype,
      ...params.extra,
    };
    return this.client.post<SplunkCollection<IndexContent>>('/services/data/indexes', body);
  }

  async deleteIndex(name: string): Promise<SplunkCollection> {
    return this.client.delete<SplunkCollection>(`/services/data/indexes/${encodeURIComponent(name)}`);
  }

  // ============================================
  // HTTP Event Collector (HEC) tokens
  // ============================================

  async listHecTokens(params?: ListParams): Promise<SplunkCollection<HecTokenContent>> {
    return this.client.get<SplunkCollection<HecTokenContent>>('/services/data/inputs/http', listToParams(params));
  }

  async createHecToken(params: CreateHecTokenParams): Promise<SplunkCollection<HecTokenContent>> {
    const body: Record<string, string | number | boolean | undefined> = {
      name: params.name,
      index: params.index,
      indexes: params.indexes,
      source: params.source,
      sourcetype: params.sourcetype,
      useACK: params.useACK,
      ...params.extra,
    };
    return this.client.post<SplunkCollection<HecTokenContent>>('/services/data/inputs/http', body);
  }

  async deleteHecToken(name: string): Promise<SplunkCollection> {
    return this.client.delete<SplunkCollection>(`/services/data/inputs/http/${encodeURIComponent(name)}`);
  }

  // ============================================
  // Users & roles
  // ============================================

  async listUsers(params?: ListParams): Promise<SplunkCollection<UserContent>> {
    return this.client.get<SplunkCollection<UserContent>>('/services/authentication/users', listToParams(params));
  }

  async getUser(name: string): Promise<UserContent> {
    const res = await this.client.get<SplunkCollection<UserContent>>(
      `/services/authentication/users/${encodeURIComponent(name)}`,
    );
    return res.entry?.[0]?.content ?? {};
  }

  async createUser(params: CreateUserParams): Promise<SplunkCollection<UserContent>> {
    const body: Record<string, string | number | boolean | undefined> = {
      name: params.name,
      password: params.password,
      roles: params.roles.join(','),
      realname: params.realname,
      email: params.email,
      defaultApp: params.defaultApp,
      ...params.extra,
    };
    return this.client.post<SplunkCollection<UserContent>>('/services/authentication/users', body);
  }

  async deleteUser(name: string): Promise<SplunkCollection> {
    return this.client.delete<SplunkCollection>(`/services/authentication/users/${encodeURIComponent(name)}`);
  }

  async listRoles(params?: ListParams): Promise<SplunkCollection<RoleContent>> {
    return this.client.get<SplunkCollection<RoleContent>>('/services/authorization/roles', listToParams(params));
  }

  async getRole(name: string): Promise<RoleContent> {
    const res = await this.client.get<SplunkCollection<RoleContent>>(
      `/services/authorization/roles/${encodeURIComponent(name)}`,
    );
    return res.entry?.[0]?.content ?? {};
  }

  // ============================================
  // Messages / fired alerts / apps
  // ============================================

  async listMessages(params?: ListParams): Promise<SplunkCollection<MessageContent>> {
    return this.client.get<SplunkCollection<MessageContent>>('/services/messages', listToParams(params));
  }

  async deleteMessage(name: string): Promise<SplunkCollection> {
    return this.client.delete<SplunkCollection>(`/services/messages/${encodeURIComponent(name)}`);
  }

  async listFiredAlerts(params?: ListParams): Promise<SplunkCollection<FiredAlertContent>> {
    return this.client.get<SplunkCollection<FiredAlertContent>>(
      '/services/alerts/fired_alerts',
      listToParams(params),
    );
  }

  async listApps(params?: ListParams): Promise<SplunkCollection<AppContent>> {
    return this.client.get<SplunkCollection<AppContent>>('/services/apps/local', listToParams(params));
  }
}
