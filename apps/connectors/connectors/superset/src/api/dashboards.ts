import type { SupersetClient } from './client';
import type { Dashboard, ListOptions, ListResult } from '../types';

const RESOURCE = '/api/v1/dashboard/';

/**
 * Dashboards API - list and fetch Superset dashboards.
 */
export class DashboardsApi {
  constructor(private readonly client: SupersetClient) {}

  /** List dashboards with optional filtering, ordering and pagination. */
  async list(options: ListOptions = {}): Promise<ListResult<Dashboard>> {
    return this.client.list<Dashboard>(RESOURCE, options);
  }

  /** Get a single dashboard by numeric id or slug. */
  async get(id: number | string): Promise<Dashboard> {
    return this.client.get<Dashboard>(RESOURCE, id);
  }

  /** Get the chart definitions embedded in a dashboard. */
  async getCharts(id: number | string): Promise<unknown> {
    return this.client.request(`${RESOURCE}${id}/charts`);
  }
}
