import { MixpanelClient } from './client';
import type { Funnel, FunnelListResponse, FunnelDataResponse, FunnelData } from '../types';

/**
 * Mixpanel Funnels API
 * Get funnel definitions and data
 */
export class FunnelsApi {
  constructor(private readonly client: MixpanelClient) {}

  /**
   * List all funnels
   */
  async list(): Promise<Funnel[]> {
    const projectId = this.client.getProjectId();
    if (!projectId) {
      throw new Error('Project ID is required for funnels API');
    }

    const result = await this.client.request<Record<string, string>>(
      '/api/2.0/funnels/list',
      {
        method: 'GET',
        params: { project_id: projectId },
        endpoint: 'data',
        authType: 'basic',
      }
    );

    // Convert the response format to array
    const funnels: Funnel[] = Object.entries(result).map(([id, name]) => ({
      funnel_id: parseInt(id),
      name: name as string,
    }));

    return funnels;
  }

  /**
   * Get funnel data
   *
   * @param funnelId Funnel ID
   * @param options Query options
   */
  async get(
    funnelId: number,
    options: {
      from_date?: string;
      to_date?: string;
      length?: number;
      length_unit?: 'day' | 'hour' | 'minute' | 'week' | 'month';
      interval?: number;
      unit?: 'day' | 'week' | 'month';
      on?: string;
      where?: string;
      limit?: number;
    } = {}
  ): Promise<FunnelData> {
    const projectId = this.client.getProjectId();
    if (!projectId) {
      throw new Error('Project ID is required for funnels API');
    }

    const params: Record<string, string | number | boolean | undefined> = {
      project_id: projectId,
      funnel_id: funnelId,
    };

    if (options.from_date) {
      params.from_date = options.from_date;
    }
    if (options.to_date) {
      params.to_date = options.to_date;
    }
    if (options.length !== undefined) {
      params.length = options.length;
    }
    if (options.length_unit) {
      params.length_unit = options.length_unit;
    }
    if (options.interval !== undefined) {
      params.interval = options.interval;
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

    const result = await this.client.request<FunnelData>(
      '/api/2.0/funnels',
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
   * Get funnel by name
   */
  async getByName(
    name: string,
    options: {
      from_date?: string;
      to_date?: string;
      length?: number;
      length_unit?: 'day' | 'hour' | 'minute' | 'week' | 'month';
      interval?: number;
      unit?: 'day' | 'week' | 'month';
      on?: string;
      where?: string;
      limit?: number;
    } = {}
  ): Promise<FunnelData | null> {
    const funnels = await this.list();
    const funnel = funnels.find(f => f.name.toLowerCase() === name.toLowerCase());

    if (!funnel) {
      return null;
    }

    return this.get(funnel.funnel_id, options);
  }
}
