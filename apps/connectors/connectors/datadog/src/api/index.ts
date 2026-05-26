import type {
  DatadogConfig,
  MetricMetadata,
  MetricSeries,
  MetricQueryResult,
  Event,
  EventCreateParams,
  Monitor,
  MonitorCreateParams,
  Dashboard,
  DashboardSummary,
  SLO,
  SLOCreateParams,
  Host,
  HostTotals,
  Downtime,
  DowntimeCreateParams,
  SyntheticsTest,
  User,
  Organization,
} from '../types';
import { DatadogClient } from './client';

/**
 * Datadog API wrapper
 */
export class Datadog {
  private readonly client: DatadogClient;

  constructor(config: DatadogConfig) {
    this.client = new DatadogClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): Datadog {
    const apiKey = process.env.DATADOG_API_KEY;
    const appKey = process.env.DATADOG_APP_KEY;
    const site = process.env.DATADOG_SITE;

    if (!apiKey) {
      throw new Error('DATADOG_API_KEY environment variable is required');
    }
    if (!appKey) {
      throw new Error('DATADOG_APP_KEY environment variable is required');
    }
    return new Datadog({ apiKey, appKey, site });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): DatadogClient {
    return this.client;
  }

  // ============================================
  // Metrics API
  // ============================================

  /**
   * Query timeseries metrics
   */
  async queryMetrics(params: {
    from: number;
    to: number;
    query: string;
  }): Promise<MetricQueryResult> {
    return this.client.get<MetricQueryResult>('/query', params);
  }

  /**
   * Get metric metadata
   */
  async getMetricMetadata(metricName: string): Promise<MetricMetadata> {
    return this.client.get<MetricMetadata>(`/metrics/${encodeURIComponent(metricName)}`);
  }

  /**
   * Update metric metadata
   */
  async updateMetricMetadata(metricName: string, metadata: MetricMetadata): Promise<MetricMetadata> {
    return this.client.put<MetricMetadata>(`/metrics/${encodeURIComponent(metricName)}`, metadata);
  }

  /**
   * List active metrics
   */
  async listActiveMetrics(params: {
    from: number;
    host?: string;
    tag_filter?: string;
  }): Promise<{ metrics: string[]; from: number }> {
    return this.client.get('/metrics', params);
  }

  /**
   * Submit metrics (timeseries data)
   */
  async submitMetrics(series: MetricSeries[]): Promise<{ status: string }> {
    return this.client.post('/series', { series });
  }

  // ============================================
  // Events API
  // ============================================

  /**
   * List events
   */
  async listEvents(params: {
    start: number;
    end: number;
    priority?: 'normal' | 'low';
    sources?: string;
    tags?: string;
    unaggregated?: boolean;
    exclude_aggregate?: boolean;
    page?: number;
  }): Promise<{ events: Event[] }> {
    return this.client.get('/events', params);
  }

  /**
   * Get an event
   */
  async getEvent(eventId: number): Promise<{ event: Event }> {
    return this.client.get(`/events/${eventId}`);
  }

  /**
   * Create an event
   */
  async createEvent(event: EventCreateParams): Promise<{ event: Event }> {
    return this.client.post('/events', event);
  }

  // ============================================
  // Monitors API
  // ============================================

  /**
   * List monitors
   */
  async listMonitors(params?: {
    group_states?: string;
    name?: string;
    tags?: string;
    monitor_tags?: string;
    with_downtimes?: boolean;
    id_offset?: number;
    page?: number;
    page_size?: number;
  }): Promise<Monitor[]> {
    return this.client.get('/monitor', params);
  }

  /**
   * Get a monitor
   */
  async getMonitor(monitorId: number, params?: {
    group_states?: string;
    with_downtimes?: boolean;
  }): Promise<Monitor> {
    return this.client.get(`/monitor/${monitorId}`, params);
  }

  /**
   * Create a monitor
   */
  async createMonitor(monitor: MonitorCreateParams): Promise<Monitor> {
    return this.client.post('/monitor', monitor);
  }

  /**
   * Update a monitor
   */
  async updateMonitor(monitorId: number, monitor: Partial<MonitorCreateParams>): Promise<Monitor> {
    return this.client.put(`/monitor/${monitorId}`, monitor);
  }

  /**
   * Delete a monitor
   */
  async deleteMonitor(monitorId: number, params?: {
    force?: boolean;
  }): Promise<{ deleted_monitor_id: number }> {
    return this.client.delete(`/monitor/${monitorId}`, params);
  }

  /**
   * Mute a monitor
   */
  async muteMonitor(monitorId: number, params?: {
    scope?: string;
    end?: number;
  }): Promise<Monitor> {
    return this.client.post(`/monitor/${monitorId}/mute`, params);
  }

  /**
   * Unmute a monitor
   */
  async unmuteMonitor(monitorId: number, params?: {
    scope?: string;
    all_scopes?: boolean;
  }): Promise<Monitor> {
    return this.client.post(`/monitor/${monitorId}/unmute`, params);
  }

  // ============================================
  // Dashboards API
  // ============================================

  /**
   * List dashboards
   */
  async listDashboards(params?: {
    filter_shared?: boolean;
    filter_deleted?: boolean;
    count?: number;
    start?: number;
  }): Promise<{ dashboards: DashboardSummary[] }> {
    return this.client.get('/dashboard', params);
  }

  /**
   * Get a dashboard
   */
  async getDashboard(dashboardId: string): Promise<Dashboard> {
    return this.client.get(`/dashboard/${dashboardId}`);
  }

  /**
   * Create a dashboard
   */
  async createDashboard(dashboard: Omit<Dashboard, 'id'>): Promise<Dashboard> {
    return this.client.post('/dashboard', dashboard);
  }

  /**
   * Update a dashboard
   */
  async updateDashboard(dashboardId: string, dashboard: Omit<Dashboard, 'id'>): Promise<Dashboard> {
    return this.client.put(`/dashboard/${dashboardId}`, dashboard);
  }

  /**
   * Delete a dashboard
   */
  async deleteDashboard(dashboardId: string): Promise<{ deleted_dashboard_id: string }> {
    return this.client.delete(`/dashboard/${dashboardId}`);
  }

  // ============================================
  // SLOs API
  // ============================================

  /**
   * List SLOs
   */
  async listSLOs(params?: {
    ids?: string;
    query?: string;
    tags_query?: string;
    metrics_query?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: SLO[] }> {
    return this.client.get('/slo', params);
  }

  /**
   * Get an SLO
   */
  async getSLO(sloId: string, params?: {
    with_configured_alert_ids?: boolean;
  }): Promise<{ data: SLO }> {
    return this.client.get(`/slo/${sloId}`, params);
  }

  /**
   * Create an SLO
   */
  async createSLO(slo: SLOCreateParams): Promise<{ data: SLO[] }> {
    return this.client.post('/slo', slo);
  }

  /**
   * Update an SLO
   */
  async updateSLO(sloId: string, slo: Partial<SLOCreateParams>): Promise<{ data: SLO[] }> {
    return this.client.put(`/slo/${sloId}`, slo);
  }

  /**
   * Delete an SLO
   */
  async deleteSLO(sloId: string, params?: {
    force?: boolean;
  }): Promise<{ data: string[] }> {
    return this.client.delete(`/slo/${sloId}`, params);
  }

  /**
   * Get SLO history
   */
  async getSLOHistory(sloId: string, params: {
    from_ts: number;
    to_ts: number;
    target?: number;
    apply_correction?: boolean;
  }): Promise<{ data: unknown }> {
    return this.client.get(`/slo/${sloId}/history`, params);
  }

  // ============================================
  // Hosts API
  // ============================================

  /**
   * List hosts
   */
  async listHosts(params?: {
    filter?: string;
    sort_field?: string;
    sort_dir?: 'asc' | 'desc';
    start?: number;
    count?: number;
    from?: number;
    include_muted_hosts_data?: boolean;
    include_hosts_metadata?: boolean;
  }): Promise<{ host_list: Host[]; total_matching?: number; total_returned?: number }> {
    return this.client.get('/hosts', params);
  }

  /**
   * Get host totals
   */
  async getHostTotals(params?: {
    from?: number;
  }): Promise<HostTotals> {
    return this.client.get('/hosts/totals', params);
  }

  /**
   * Mute a host
   */
  async muteHost(hostName: string, params?: {
    end?: number;
    message?: string;
    override?: boolean;
  }): Promise<{ action: string; hostname: string; message?: string }> {
    return this.client.post(`/host/${encodeURIComponent(hostName)}/mute`, params);
  }

  /**
   * Unmute a host
   */
  async unmuteHost(hostName: string): Promise<{ action: string; hostname: string }> {
    return this.client.post(`/host/${encodeURIComponent(hostName)}/unmute`);
  }

  // ============================================
  // Downtimes API
  // ============================================

  /**
   * List downtimes
   */
  async listDowntimes(params?: {
    current_only?: boolean;
    with_creator?: boolean;
  }): Promise<Downtime[]> {
    return this.client.get('/downtime', params);
  }

  /**
   * Get a downtime
   */
  async getDowntime(downtimeId: number): Promise<Downtime> {
    return this.client.get(`/downtime/${downtimeId}`);
  }

  /**
   * Create a downtime
   */
  async createDowntime(downtime: DowntimeCreateParams): Promise<Downtime> {
    return this.client.post('/downtime', downtime);
  }

  /**
   * Update a downtime
   */
  async updateDowntime(downtimeId: number, downtime: Partial<DowntimeCreateParams>): Promise<Downtime> {
    return this.client.put(`/downtime/${downtimeId}`, downtime);
  }

  /**
   * Delete a downtime
   */
  async deleteDowntime(downtimeId: number): Promise<void> {
    await this.client.delete(`/downtime/${downtimeId}`);
  }

  /**
   * Cancel downtimes by scope
   */
  async cancelDowntimesByScope(scope: string): Promise<{ cancelled_ids: number[] }> {
    return this.client.post('/downtime/cancel/by_scope', { scope });
  }

  // ============================================
  // Synthetics API
  // ============================================

  /**
   * List synthetics tests
   */
  async listSyntheticsTests(params?: {
    page_size?: number;
    page_number?: number;
    locations?: string;
  }): Promise<{ tests: SyntheticsTest[] }> {
    return this.client.get('/synthetics/tests', params);
  }

  /**
   * Get a synthetics test
   */
  async getSyntheticsTest(publicId: string): Promise<SyntheticsTest> {
    return this.client.get(`/synthetics/tests/${publicId}`);
  }

  /**
   * Create a synthetics test
   */
  async createSyntheticsTest(test: Omit<SyntheticsTest, 'public_id'>): Promise<SyntheticsTest> {
    return this.client.post('/synthetics/tests', test);
  }

  /**
   * Update a synthetics test
   */
  async updateSyntheticsTest(publicId: string, test: Partial<SyntheticsTest>): Promise<SyntheticsTest> {
    return this.client.put(`/synthetics/tests/${publicId}`, test);
  }

  /**
   * Delete a synthetics test
   */
  async deleteSyntheticsTest(publicIds: string[]): Promise<{ deleted_tests: Array<{ public_id: string }> }> {
    return this.client.post('/synthetics/tests/delete', { public_ids: publicIds });
  }

  /**
   * Trigger synthetics tests
   */
  async triggerSyntheticsTests(publicIds: string[]): Promise<{ batch_id: string; results: unknown[] }> {
    return this.client.post('/synthetics/tests/trigger', { tests: publicIds.map(id => ({ public_id: id })) });
  }

  /**
   * Get synthetics test results
   */
  async getSyntheticsTestResults(publicId: string, params?: {
    from_ts?: number;
    to_ts?: number;
    probe_dc?: string[];
  }): Promise<{ results: unknown[] }> {
    return this.client.get(`/synthetics/tests/${publicId}/results`, params);
  }

  // ============================================
  // Users API (v2)
  // ============================================

  /**
   * List users
   */
  async listUsers(params?: {
    page_size?: number;
    page_number?: number;
    sort?: string;
    sort_dir?: 'asc' | 'desc';
    filter?: string;
    filter_status?: string;
  }): Promise<{ data: User[]; meta?: { page?: { total_count?: number } } }> {
    return this.client.get('/users', params, 'v2');
  }

  /**
   * Get a user
   */
  async getUser(userId: string): Promise<{ data: User }> {
    return this.client.get(`/users/${userId}`, undefined, 'v2');
  }

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<{ data: User }> {
    return this.client.get('/current_user', undefined, 'v2');
  }

  // ============================================
  // Organization API
  // ============================================

  /**
   * Get organization
   */
  async getOrganization(): Promise<{ org: Organization }> {
    return this.client.get('/org');
  }

  // ============================================
  // Validate API
  // ============================================

  /**
   * Validate API credentials
   */
  async validate(): Promise<{ valid: boolean }> {
    return this.client.get('/validate');
  }
}

export { DatadogClient } from './client';
