import type { ConnectorClient } from './client';
import type {
  MultiTransactionParams,
  SingleTransactionParams,
  WebEngageResponse,
} from '../types';

export class TransactionalApi {
  constructor(private readonly client: ConnectorClient) {}

  async send(experimentId: string, data: SingleTransactionParams): Promise<WebEngageResponse> {
    return this.client.post<WebEngageResponse>(
      this.client.accountPath('v2', `/experiments/${experimentId}/transaction`),
      data
    );
  }

  async sendMulti(data: MultiTransactionParams): Promise<WebEngageResponse> {
    return this.client.post<WebEngageResponse>(
      this.client.accountPath('v2', '/transaction'),
      data
    );
  }
}
