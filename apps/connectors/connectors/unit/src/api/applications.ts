import type { JsonApiDocument, ListApplicationsParams } from '../types';
import type { UnitClient } from './client';
import { jsonApiBody } from './client';

export class ApplicationsApi {
  constructor(private readonly client: UnitClient) {}

  list(params: ListApplicationsParams = {}): Promise<JsonApiDocument> {
    return this.client.get('/applications', {
      'page[offset]': params.offset,
      'page[limit]': params.limit,
      'filter[email]': params.email,
      'filter[query]': params.query,
      'filter[status][]': params.status,
    });
  }

  get(id: string): Promise<JsonApiDocument> {
    return this.client.get(`/applications/${encodeURIComponent(id)}`);
  }

  createIndividual(attributes: Record<string, unknown>): Promise<JsonApiDocument> {
    return this.client.post('/applications', jsonApiBody('individualApplication', attributes));
  }

  createBusiness(attributes: Record<string, unknown>): Promise<JsonApiDocument> {
    return this.client.post('/applications', jsonApiBody('businessApplication', attributes));
  }
}
