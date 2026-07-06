import type {
  SysdigConfig,
  User,
  Team,
  Alert,
  AlertCreateParams,
  Dashboard,
  NotificationChannel,
  SysdigEvent,
  EventCreateParams,
  SecurePolicy,
  ApiToken,
} from '../types';
import { SysdigClient } from './client';

/**
 * Sysdig API wrapper (Sysdig Monitor / Secure / Platform REST API).
 */
export class Sysdig {
  private readonly client: SysdigClient;

  constructor(config: SysdigConfig) {
    this.client = new SysdigClient(config);
  }

  /**
   * Create a client from environment variables.
   */
  static fromEnv(): Sysdig {
    const apiToken = process.env.SYSDIG_API_TOKEN;
    const region = process.env.SYSDIG_REGION;
    const baseUrl = process.env.SYSDIG_BASE_URL;

    if (!apiToken) {
      throw new Error('SYSDIG_API_TOKEN environment variable is required');
    }
    return new Sysdig({ apiToken, region, baseUrl });
  }

  /**
   * Get a preview of the API token (for debugging).
   */
  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  /**
   * Get the underlying client for direct API access.
   */
  getClient(): SysdigClient {
    return this.client;
  }

  // ============================================
  // Platform: Users & Teams
  // ============================================

  /**
   * Get the current (authenticated) user.
   */
  async getCurrentUser(): Promise<User> {
    const res = await this.client.get<{ user: User }>('/api/user/me');
    return res.user;
  }

  /**
   * List users in the current customer account.
   */
  async listUsers(): Promise<User[]> {
    const res = await this.client.get<{ users: User[] }>('/api/users');
    return res.users;
  }

  /**
   * Get a user by id.
   */
  async getUser(userId: number): Promise<User> {
    const res = await this.client.get<{ user: User }>(`/api/users/${userId}`);
    return res.user;
  }

  /**
   * List teams the current user can access.
   */
  async listTeams(): Promise<Team[]> {
    const res = await this.client.get<{ teams: Team[] }>('/api/teams');
    return res.teams;
  }

  /**
   * Get a team by id.
   */
  async getTeam(teamId: number): Promise<Team> {
    const res = await this.client.get<{ team: Team }>(`/api/teams/${teamId}`);
    return res.team;
  }

  /**
   * Get the API token for the current user/team.
   */
  async getToken(): Promise<ApiToken> {
    const res = await this.client.get<{ token: ApiToken }>('/api/token');
    return res.token;
  }

  /**
   * Validate credentials by fetching the current user.
   */
  async validate(): Promise<boolean> {
    await this.getCurrentUser();
    return true;
  }

  // ============================================
  // Monitor: Alerts
  // ============================================

  /**
   * List alerts.
   */
  async listAlerts(): Promise<Alert[]> {
    const res = await this.client.get<{ alerts: Alert[] }>('/api/alerts');
    return res.alerts;
  }

  /**
   * Get an alert by id.
   */
  async getAlert(alertId: number): Promise<Alert> {
    const res = await this.client.get<{ alert: Alert }>(`/api/alerts/${alertId}`);
    return res.alert;
  }

  /**
   * Create an alert.
   */
  async createAlert(alert: AlertCreateParams): Promise<Alert> {
    const res = await this.client.post<{ alert: Alert }>('/api/alerts', { alert });
    return res.alert;
  }

  /**
   * Update an alert. The full alert object (including id and version) is required.
   */
  async updateAlert(alertId: number, alert: Alert): Promise<Alert> {
    const res = await this.client.put<{ alert: Alert }>(`/api/alerts/${alertId}`, { alert });
    return res.alert;
  }

  /**
   * Delete an alert.
   */
  async deleteAlert(alertId: number): Promise<void> {
    await this.client.delete(`/api/alerts/${alertId}`);
  }

  // ============================================
  // Monitor: Dashboards (v3)
  // ============================================

  /**
   * List dashboards.
   */
  async listDashboards(): Promise<Dashboard[]> {
    const res = await this.client.get<{ dashboards: Dashboard[] }>('/api/v3/dashboards');
    return res.dashboards;
  }

  /**
   * Get a dashboard by id.
   */
  async getDashboard(dashboardId: number): Promise<Dashboard> {
    const res = await this.client.get<{ dashboard: Dashboard }>(`/api/v3/dashboards/${dashboardId}`);
    return res.dashboard;
  }

  /**
   * Delete a dashboard.
   */
  async deleteDashboard(dashboardId: number): Promise<void> {
    await this.client.delete(`/api/v3/dashboards/${dashboardId}`);
  }

  // ============================================
  // Monitor: Notification Channels
  // ============================================

  /**
   * List notification channels.
   */
  async listNotificationChannels(): Promise<NotificationChannel[]> {
    const res = await this.client.get<{ notificationChannels: NotificationChannel[] }>(
      '/api/notificationChannels',
    );
    return res.notificationChannels;
  }

  /**
   * Get a notification channel by id.
   */
  async getNotificationChannel(channelId: number): Promise<NotificationChannel> {
    const res = await this.client.get<{ notificationChannel: NotificationChannel }>(
      `/api/notificationChannels/${channelId}`,
    );
    return res.notificationChannel;
  }

  // ============================================
  // Monitor: Events (v2)
  // ============================================

  /**
   * List events.
   */
  async listEvents(params?: {
    from?: number;
    to?: number;
    limit?: number;
    filter?: string;
    category?: string;
  }): Promise<SysdigEvent[]> {
    const res = await this.client.get<{ events: SysdigEvent[] }>('/api/v2/events', params);
    return res.events;
  }

  /**
   * Get an event by id.
   */
  async getEvent(eventId: string): Promise<SysdigEvent> {
    const res = await this.client.get<{ event: SysdigEvent }>(`/api/v2/events/${eventId}`);
    return res.event;
  }

  /**
   * Post a custom event.
   */
  async createEvent(event: EventCreateParams): Promise<SysdigEvent> {
    const res = await this.client.post<{ event: SysdigEvent }>('/api/v2/events', { event });
    return res.event;
  }

  /**
   * Delete an event.
   */
  async deleteEvent(eventId: string): Promise<void> {
    await this.client.delete(`/api/v2/events/${eventId}`);
  }

  // ============================================
  // Secure: Policies
  // ============================================

  /**
   * List Sysdig Secure policies.
   */
  async listSecurePolicies(): Promise<SecurePolicy[]> {
    return this.client.get<SecurePolicy[]>('/api/v1/secure/policies', undefined, 'secure');
  }

  /**
   * Get a Sysdig Secure policy by id.
   */
  async getSecurePolicy(policyId: number): Promise<SecurePolicy> {
    return this.client.get<SecurePolicy>(`/api/v1/secure/policies/${policyId}`);
  }
}

export { SysdigClient, REGIONS, DEFAULT_REGION, resolveBaseUrl } from './client';
