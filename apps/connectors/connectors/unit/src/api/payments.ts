import type {
  JsonApiDocument,
  CreateAchPaymentParams,
  CreateBookPaymentParams,
  ListPaymentsParams,
} from '../types';
import type { UnitClient } from './client';
import { jsonApiBody } from './client';

export class PaymentsApi {
  constructor(private readonly client: UnitClient) {}

  list(params: ListPaymentsParams = {}): Promise<JsonApiDocument> {
    return this.client.get('/payments', {
      'page[offset]': params.offset,
      'page[limit]': params.limit,
      'filter[accountId]': params.accountId,
      'filter[customerId]': params.customerId,
      'filter[status][]': params.status,
      'filter[direction]': params.direction,
      'filter[type][]': params.type,
    });
  }

  get(id: string): Promise<JsonApiDocument> {
    return this.client.get(`/payments/${encodeURIComponent(id)}`);
  }

  createAch(params: CreateAchPaymentParams): Promise<JsonApiDocument> {
    const relationships: Record<string, unknown> = {
      account: { data: { type: 'depositAccount', id: params.accountId } },
    };
    if (params.counterpartyId) {
      relationships.counterparty = { data: { type: 'counterparty', id: params.counterpartyId } };
    }

    return this.client.post('/payments', jsonApiBody(
      'achPayment',
      {
        direction: params.direction,
        amount: params.amount,
        description: params.description,
        counterparty: params.counterparty,
        addenda: params.addenda,
        idempotencyKey: params.idempotencyKey,
        tags: params.tags,
      },
      relationships,
    ));
  }

  createBook(params: CreateBookPaymentParams): Promise<JsonApiDocument> {
    return this.client.post('/payments', jsonApiBody(
      'bookPayment',
      {
        amount: params.amount,
        description: params.description,
        idempotencyKey: params.idempotencyKey,
        tags: params.tags,
      },
      {
        account: { data: { type: 'depositAccount', id: params.accountId } },
        counterpartyAccount: { data: { type: 'depositAccount', id: params.counterpartyAccountId } },
      },
    ));
  }
}
