import { MixpanelClient } from './client';
import type { RetentionParams, RetentionData, RetentionResponse } from '../types';

/**
 * Mixpanel Retention API
 * Get retention cohort data
 */
export class RetentionApi {
  constructor(private readonly client: MixpanelClient) {}

  /**
   * Get retention data
   *
   * @param from_date Start date (YYYY-MM-DD)
   * @param to_date End date (YYYY-MM-DD)
   * @param options Retention options
   */
  async get(
    from_date: string,
    to_date: string,
    options: Partial<Omit<RetentionParams, 'from_date' | 'to_date'>> = {}
  ): Promise<RetentionData[]> {
    const projectId = this.client.getProjectId();
    if (!projectId) {
      throw new Error('Project ID is required for retention API');
    }

    const params: Record<string, string | number | boolean | undefined> = {
      project_id: projectId,
      from_date,
      to_date,
    };

    if (options.retention_type) {
      params.retention_type = options.retention_type;
    }
    if (options.born_event) {
      params.born_event = options.born_event;
    }
    if (options.event) {
      params.event = options.event;
    }
    if (options.born_where) {
      params.born_where = options.born_where;
    }
    if (options.where) {
      params.where = options.where;
    }
    if (options.interval !== undefined) {
      params.interval = options.interval;
    }
    if (options.interval_count !== undefined) {
      params.interval_count = options.interval_count;
    }
    if (options.unit) {
      params.unit = options.unit;
    }

    const result = await this.client.request<RetentionResponse | Record<string, unknown>>(
      '/api/2.0/retention',
      {
        method: 'GET',
        params,
        endpoint: 'data',
        authType: 'basic',
      }
    );

    // Handle different response formats
    if ('data' in result && Array.isArray(result.data)) {
      return result.data as RetentionData[];
    }

    // Convert object format to array
    const data: RetentionData[] = [];
    const resultObj = result as Record<string, unknown>;

    for (const [date, value] of Object.entries(resultObj)) {
      if (typeof value === 'object' && value !== null) {
        const item = value as Record<string, unknown>;
        data.push({
          date,
          count: (item.count as number) || 0,
          first: (item.first as number) || 0,
          counts: (item.counts as number[]) || [],
        });
      }
    }

    return data;
  }

  /**
   * Get addiction retention (compounded retention)
   * Shows users who came back on day N, regardless of previous days
   */
  async getCompounded(
    from_date: string,
    to_date: string,
    options: Partial<Omit<RetentionParams, 'from_date' | 'to_date' | 'retention_type'>> = {}
  ): Promise<RetentionData[]> {
    return this.get(from_date, to_date, {
      ...options,
      retention_type: 'compounded',
    });
  }

  /**
   * Get birth retention (standard retention)
   * Shows users who came back on day N after their first action
   */
  async getBirth(
    from_date: string,
    to_date: string,
    options: Partial<Omit<RetentionParams, 'from_date' | 'to_date' | 'retention_type'>> = {}
  ): Promise<RetentionData[]> {
    return this.get(from_date, to_date, {
      ...options,
      retention_type: 'birth',
    });
  }

  /**
   * Get retention for a specific cohort based on an event
   */
  async getForEvent(
    bornEvent: string,
    returnEvent: string,
    from_date: string,
    to_date: string,
    options: Partial<Omit<RetentionParams, 'from_date' | 'to_date' | 'born_event' | 'event'>> = {}
  ): Promise<RetentionData[]> {
    return this.get(from_date, to_date, {
      ...options,
      born_event: bornEvent,
      event: returnEvent,
    });
  }
}
