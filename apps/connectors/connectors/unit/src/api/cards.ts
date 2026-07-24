import type { JsonApiDocument, ListCardsParams, CreateDebitCardParams } from '../types';
import type { UnitClient } from './client';
import { jsonApiBody } from './client';

export class CardsApi {
  constructor(private readonly client: UnitClient) {}

  list(params: ListCardsParams = {}): Promise<JsonApiDocument> {
    return this.client.get('/cards', {
      'page[offset]': params.offset,
      'page[limit]': params.limit,
      'filter[accountId]': params.accountId,
      'filter[customerId]': params.customerId,
      'filter[status][]': params.status,
      'filter[type]': params.type,
    });
  }

  get(id: string): Promise<JsonApiDocument> {
    return this.client.get(`/cards/${encodeURIComponent(id)}`);
  }

  createDebitCard(params: CreateDebitCardParams): Promise<JsonApiDocument> {
    return this.client.post('/cards', jsonApiBody(
      params.type,
      {
        shippingAddress: params.shippingAddress,
        designId: params.designId,
        fullName: params.fullName,
        dateOfBirth: params.dateOfBirth,
        address: params.address,
        phone: params.phone,
        email: params.email,
        idempotencyKey: params.idempotencyKey,
        tags: params.tags,
      },
      {
        account: { data: { type: 'depositAccount', id: params.accountId } },
      },
    ));
  }

  freeze(id: string): Promise<JsonApiDocument> {
    return this.client.post(`/cards/${encodeURIComponent(id)}/freeze`);
  }

  unfreeze(id: string): Promise<JsonApiDocument> {
    return this.client.post(`/cards/${encodeURIComponent(id)}/unfreeze`);
  }

  close(id: string): Promise<JsonApiDocument> {
    return this.client.post(`/cards/${encodeURIComponent(id)}/close`);
  }

  reportLost(id: string): Promise<JsonApiDocument> {
    return this.client.post(`/cards/${encodeURIComponent(id)}/report-lost`);
  }

  reportStolen(id: string): Promise<JsonApiDocument> {
    return this.client.post(`/cards/${encodeURIComponent(id)}/report-stolen`);
  }
}
