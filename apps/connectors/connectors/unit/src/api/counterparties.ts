import type { JsonApiDocument, ListCounterpartiesParams, CreateCounterpartyParams } from '../types';
import type { UnitClient } from './client';
import { jsonApiBody } from './client';

export class CounterpartiesApi {
  constructor(private readonly client: UnitClient) {}

  list(params: ListCounterpartiesParams = {}): Promise<JsonApiDocument> {
    return this.client.get('/counterparties', {
      'page[offset]': params.offset,
      'page[limit]': params.limit,
      'filter[customerId]': params.customerId,
      'filter[permissions][]': params.permissions,
      'filter[routingNumber]': params.routingNumber,
    });
  }

  create(params: CreateCounterpartyParams): Promise<JsonApiDocument> {
    return this.client.post('/counterparties', jsonApiBody(
      'achCounterparty',
      {
        name: params.name,
        routingNumber: params.routingNumber,
        accountNumber: params.accountNumber,
        accountType: params.accountType,
        type: params.type,
        permissions: params.permissions,
        idempotencyKey: params.idempotencyKey,
        tags: params.tags,
      },
      {
        customer: { data: { type: 'customer', id: params.customerId } },
      },
    ));
  }

  delete(id: string): Promise<JsonApiDocument> {
    return this.client.delete(`/counterparties/${encodeURIComponent(id)}`);
  }
}
