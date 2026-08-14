import type { SnovIoClient } from './client';
import type { BalanceResponse } from '../types';

export class AccountApi {
  constructor(private readonly client: SnovIoClient) {}

  /** Check credit balance (GET /v1/get-balance) */
  async getBalance(): Promise<BalanceResponse> {
    return this.client.getV1<BalanceResponse>('/v1/get-balance');
  }
}
