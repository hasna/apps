import type { SupersetClient } from './client';
import type { Chart, ListOptions, ListResult } from '../types';

const RESOURCE = '/api/v1/chart/';

/**
 * Charts API - list and fetch Superset charts (slices).
 */
export class ChartsApi {
  constructor(private readonly client: SupersetClient) {}

  /** List charts with optional filtering, ordering and pagination. */
  async list(options: ListOptions = {}): Promise<ListResult<Chart>> {
    return this.client.list<Chart>(RESOURCE, options);
  }

  /** Get a single chart by id. */
  async get(id: number | string): Promise<Chart> {
    return this.client.get<Chart>(RESOURCE, id);
  }
}
