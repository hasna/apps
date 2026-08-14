import type { JsonApiDocument, ListCustomersParams } from '../types';
import type { UnitClient } from './client';
import { jsonApiBody } from './client';

export class CustomersApi {
  constructor(private readonly client: UnitClient) {}

  list(params: ListCustomersParams = {}): Promise<JsonApiDocument> {
    return this.client.get('/customers', {
      'page[offset]': params.offset,
      'page[limit]': params.limit,
      'filter[status][]': params.status,
      'filter[query]': params.query,
      'filter[email]': params.email,
    });
  }

  get(id: string): Promise<JsonApiDocument> {
    return this.client.get(`/customers/${encodeURIComponent(id)}`);
  }

  archive(id: string, reason?: string): Promise<JsonApiDocument> {
    return this.client.post(
      `/customers/${encodeURIComponent(id)}/archive`,
      jsonApiBody('archiveCustomer', { reason }),
    );
  }
}
