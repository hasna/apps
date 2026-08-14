import type { Dataset, ListResponse } from '../types';
import { TraverseClient } from './client';

export class DatasetsApi {
  constructor(private readonly client: TraverseClient) {}

  list(params?: Record<string, string | number | boolean | undefined>): Promise<ListResponse<Dataset>> {
    return this.client.get<ListResponse<Dataset>>('/datasets', params);
  }
}
