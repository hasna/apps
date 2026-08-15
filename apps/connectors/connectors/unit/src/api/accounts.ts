import type {
  JsonApiDocument,
  ListAccountsParams,
  CreateDepositAccountParams,
  CloseAccountParams,
} from '../types';
import type { UnitClient } from './client';
import { jsonApiBody } from './client';

export class AccountsApi {
  constructor(private readonly client: UnitClient) {}

  list(params: ListAccountsParams = {}): Promise<JsonApiDocument> {
    return this.client.get('/accounts', {
      'page[offset]': params.offset,
      'page[limit]': params.limit,
      'filter[customerId]': params.customerId,
      'filter[status][]': params.status,
      'filter[fromBalance]': params.fromBalance,
      'filter[toBalance]': params.toBalance,
    });
  }

  get(id: string): Promise<JsonApiDocument> {
    return this.client.get(`/accounts/${encodeURIComponent(id)}`);
  }

  createDepositAccount(params: CreateDepositAccountParams): Promise<JsonApiDocument> {
    return this.client.post('/accounts', jsonApiBody(
      'depositAccount',
      {
        depositProduct: params.depositProduct,
        idempotencyKey: params.idempotencyKey,
        tags: params.tags,
      },
      {
        customer: { data: { type: 'customer', id: params.customerId } },
      },
    ));
  }

  close(id: string, params: CloseAccountParams = {}): Promise<JsonApiDocument> {
    return this.client.post(
      `/accounts/${encodeURIComponent(id)}/close`,
      jsonApiBody('accountClose', {
        reason: params.reason,
        reasonText: params.reasonText,
      }),
    );
  }

  freeze(id: string, reason?: string, reasonText?: string): Promise<JsonApiDocument> {
    return this.client.post(
      `/accounts/${encodeURIComponent(id)}/freeze`,
      jsonApiBody('accountFreeze', { reason, reasonText }),
    );
  }

  unfreeze(id: string): Promise<JsonApiDocument> {
    return this.client.post(`/accounts/${encodeURIComponent(id)}/unfreeze`);
  }
}
