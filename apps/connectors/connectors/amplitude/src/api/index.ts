import type {
  AmplitudeConfig,
  Event,
  BatchEventResponse,
  UserSearch,
  UserActivity,
  Cohort,
  ListCohortsResult,
  CohortMembership,
  ChartData,
  EventType,
  EventProperty,
  UserProperty,
} from '../types';
import { AmplitudeClient } from './client';

/**
 * Amplitude API wrapper
 */
export class Amplitude {
  private readonly client: AmplitudeClient;

  constructor(config: AmplitudeConfig) {
    this.client = new AmplitudeClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): Amplitude {
    const apiKey = process.env.AMPLITUDE_API_KEY;
    const secretKey = process.env.AMPLITUDE_SECRET_KEY;

    if (!apiKey) {
      throw new Error('AMPLITUDE_API_KEY environment variable is required');
    }
    if (!secretKey) {
      throw new Error('AMPLITUDE_SECRET_KEY environment variable is required');
    }
    return new Amplitude({ apiKey, secretKey });
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
  getClient(): AmplitudeClient {
    return this.client;
  }

  // ============================================
  // Events API
  // ============================================

  /**
   * Upload events (batch)
   * Sends events to Amplitude's batch event upload endpoint
   */
  async uploadEvents(events: Event[]): Promise<BatchEventResponse> {
    return this.client.post<BatchEventResponse>('/httpapi', {
      api_key: undefined, // Will use Basic Auth instead
      events,
    }, undefined, true);
  }

  /**
   * Track a single event
   */
  async trackEvent(event: Event): Promise<BatchEventResponse> {
    return this.uploadEvents([event]);
  }

  // ============================================
  // Users API
  // ============================================

  /**
   * Search for users
   */
  async searchUsers(user: string): Promise<UserSearch> {
    return this.client.get<UserSearch>('/usersearch', { user });
  }

  /**
   * Get user activity
   */
  async getUserActivity(params: {
    user?: string;
    amplitude_id?: number;
    offset?: number;
    limit?: number;
  }): Promise<UserActivity> {
    return this.client.get<UserActivity>('/useractivity', params as Record<string, string | number | boolean | undefined>);
  }

  // ============================================
  // Cohorts API
  // ============================================

  /**
   * List all cohorts
   */
  async listCohorts(): Promise<ListCohortsResult> {
    return this.client.get<ListCohortsResult>('/cohorts');
  }

  /**
   * Get cohort by ID
   */
  async getCohort(cohortId: string): Promise<Cohort> {
    const result = await this.client.get<{ cohort: Cohort }>(`/cohorts/${cohortId}`);
    return result.cohort;
  }

  /**
   * Get cohort membership
   * Returns user IDs or amplitude IDs that are members of the cohort
   */
  async getCohortMembership(cohortId: string, params?: {
    props?: number; // 1 to include user properties
    propKeys?: string; // Comma-separated list of property keys
  }): Promise<CohortMembership> {
    return this.client.get<CohortMembership>(`/cohorts/${cohortId}/users`, params as Record<string, string | number | boolean | undefined>);
  }

  // ============================================
  // Charts API
  // ============================================

  /**
   * Get chart data
   * Retrieves data from a saved chart
   */
  async getChartData(chartId: string, params?: {
    start?: string; // YYYYMMDD format
    end?: string;   // YYYYMMDD format
  }): Promise<ChartData> {
    return this.client.get<ChartData>(`/chart/${chartId}/query`, params as Record<string, string | number | boolean | undefined>);
  }

  // ============================================
  // Taxonomy API
  // ============================================

  /**
   * List event types
   */
  async listEventTypes(): Promise<{ data: EventType[] }> {
    return this.client.get<{ data: EventType[] }>('/taxonomy/event');
  }

  /**
   * Get event type by name
   */
  async getEventType(eventType: string): Promise<{ data: EventType }> {
    return this.client.get<{ data: EventType }>(`/taxonomy/event/${encodeURIComponent(eventType)}`);
  }

  /**
   * List event properties for an event type
   */
  async listEventProperties(eventType: string): Promise<{ data: EventProperty[] }> {
    return this.client.get<{ data: EventProperty[] }>(`/taxonomy/event/${encodeURIComponent(eventType)}/properties`);
  }

  /**
   * Get event property
   */
  async getEventProperty(eventType: string, propertyName: string): Promise<{ data: EventProperty }> {
    return this.client.get<{ data: EventProperty }>(`/taxonomy/event/${encodeURIComponent(eventType)}/properties/${encodeURIComponent(propertyName)}`);
  }

  /**
   * List user properties
   */
  async listUserProperties(): Promise<{ data: UserProperty[] }> {
    return this.client.get<{ data: UserProperty[] }>('/taxonomy/user-property');
  }

  /**
   * Get user property by name
   */
  async getUserProperty(propertyName: string): Promise<{ data: UserProperty }> {
    return this.client.get<{ data: UserProperty }>(`/taxonomy/user-property/${encodeURIComponent(propertyName)}`);
  }

  // ============================================
  // Export API
  // ============================================

  /**
   * Export raw event data
   * Returns a URL to download the exported data
   * Note: This is for the Export API which uses different authentication
   */
  async exportData(params: {
    start: string; // YYYYMMDDTHH format (e.g., "20240101T00")
    end: string;   // YYYYMMDDTHH format (e.g., "20240101T23")
  }): Promise<string> {
    // Export API returns gzipped JSON Lines format
    const response = await this.client.get<string>('/export', {
      start: params.start,
      end: params.end,
    });
    return response;
  }
}

export { AmplitudeClient } from './client';
