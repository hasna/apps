import type { JsonApiDocument, ListTransactionsParams } from '../types';
import type { UnitClient } from './client';

export class TransactionsApi {
  constructor(private readonly client: UnitClient) {}

  list(params: ListTransactionsParams = {}): Promise<JsonApiDocument> {
    return this.client.get('/transactions', {
      'page[offset]': params.offset,
      'page[limit]': params.limit,
      'filter[accountId]': params.accountId,
      'filter[customerId]': params.customerId,
      'filter[type][]': params.type,
      'filter[since]': params.since,
      'filter[until]': params.until,
      'filter[cardId]': params.cardId,
      'filter[excludeFees]': params.excludeFees,
    });
  }

  get(accountId: string, transactionId: string): Promise<JsonApiDocument> {
    return this.client.get(
      `/accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(transactionId)}`,
    );
  }
}
