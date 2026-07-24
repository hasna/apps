import type { SupersetClient } from './client';
import type { Dataset, ListOptions, ListResult } from '../types';

const RESOURCE = '/api/v1/dataset/';

/**
 * Datasets API - list and fetch Superset datasets (tables).
 */
export class DatasetsApi {
  constructor(private readonly client: SupersetClient) {}

  /** List datasets with optional filtering, ordering and pagination. */
  async list(options: ListOptions = {}): Promise<ListResult<Dataset>> {
    return this.client.list<Dataset>(RESOURCE, options);
  }

  /** Get a single dataset by id. */
  async get(id: number | string): Promise<Dataset> {
    return this.client.get<Dataset>(RESOURCE, id);
  }
}
