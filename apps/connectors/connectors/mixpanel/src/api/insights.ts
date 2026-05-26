import { MixpanelClient } from './client';
import type { JQLQuery, JQLResponse, SegmentationParams, SegmentationResponse } from '../types';

/**
 * Mixpanel Insights API
 * Query analytics data using JQL and get segmentation reports
 */
export class InsightsApi {
  constructor(private readonly client: MixpanelClient) {}

  /**
   * Execute a JQL (JavaScript Query Language) query
   *
   * @param script JQL script to execute
   * @param params Optional parameters for the script
   */
  async query(script: string, params?: Record<string, unknown>): Promise<JQLResponse> {
    const projectId = this.client.getProjectId();
    if (!projectId) {
      throw new Error('Project ID is required for JQL queries');
    }

    const body: Record<string, unknown> = { script };
    if (params) {
      body.params = params;
    }

    return this.client.request<JQLResponse>(
      `/api/2.0/jql?project_id=${projectId}`,
      {
        method: 'POST',
        body,
        endpoint: 'data',
        authType: 'basic',
      }
    );
  }

  /**
   * Get segmentation data for an event
   *
   * @param event Event name
   * @param from_date Start date (YYYY-MM-DD)
   * @param to_date End date (YYYY-MM-DD)
   * @param options Additional segmentation options
   */
  async segmentation(
    event: string,
    from_date: string,
    to_date: string,
    options: Partial<Omit<SegmentationParams, 'event' | 'from_date' | 'to_date'>> = {}
  ): Promise<SegmentationResponse> {
    const projectId = this.client.getProjectId();
    if (!projectId) {
      throw new Error('Project ID is required for segmentation queries');
    }

    const params: Record<string, string | number | boolean | undefined> = {
      event,
      from_date,
      to_date,
      project_id: projectId,
    };

    if (options.type) {
      params.type = options.type;
    }
    if (options.unit) {
      params.unit = options.unit;
    }
    if (options.on) {
      params.on = options.on;
    }
    if (options.where) {
      params.where = options.where;
    }
    if (options.limit !== undefined) {
      params.limit = options.limit;
    }

    return this.client.request<SegmentationResponse>(
      '/api/2.0/segmentation',
      {
        method: 'GET',
        params,
        endpoint: 'data',
        authType: 'basic',
      }
    );
  }

  /**
   * Get event names (list of events)
   */
  async getEventNames(options: {
    type?: 'general' | 'unique' | 'average';
    limit?: number;
  } = {}): Promise<string[]> {
    const projectId = this.client.getProjectId();
    if (!projectId) {
      throw new Error('Project ID is required for getting event names');
    }

    const params: Record<string, string | number | boolean | undefined> = {
      project_id: projectId,
    };

    if (options.type) {
      params.type = options.type;
    }
    if (options.limit !== undefined) {
      params.limit = options.limit;
    }

    const result = await this.client.request<string[]>(
      '/api/2.0/events/names',
      {
        method: 'GET',
        params,
        endpoint: 'data',
        authType: 'basic',
      }
    );

    return result;
  }

  /**
   * Get event properties
   */
  async getEventProperties(event: string, options: {
    limit?: number;
  } = {}): Promise<Record<string, unknown>> {
    const projectId = this.client.getProjectId();
    if (!projectId) {
      throw new Error('Project ID is required for getting event properties');
    }

    const params: Record<string, string | number | boolean | undefined> = {
      project_id: projectId,
      event,
    };

    if (options.limit !== undefined) {
      params.limit = options.limit;
    }

    return this.client.request<Record<string, unknown>>(
      '/api/2.0/events/properties',
      {
        method: 'GET',
        params,
        endpoint: 'data',
        authType: 'basic',
      }
    );
  }

  /**
   * Get top property values for a property
   */
  async getTopPropertyValues(
    event: string,
    property: string,
    options: {
      limit?: number;
      type?: 'general' | 'unique' | 'average';
    } = {}
  ): Promise<Record<string, number>> {
    const projectId = this.client.getProjectId();
    if (!projectId) {
      throw new Error('Project ID is required for getting property values');
    }

    const params: Record<string, string | number | boolean | undefined> = {
      project_id: projectId,
      event,
      name: property,
    };

    if (options.limit !== undefined) {
      params.limit = options.limit;
    }
    if (options.type) {
      params.type = options.type;
    }

    return this.client.request<Record<string, number>>(
      '/api/2.0/events/properties/values',
      {
        method: 'GET',
        params,
        endpoint: 'data',
        authType: 'basic',
      }
    );
  }
}
