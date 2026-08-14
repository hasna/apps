import type { ApiEnvelope } from '../types';
import type { TotalisClient } from './client';

export class WalletApi {
  constructor(private readonly client: TotalisClient) {}

  get(): Promise<ApiEnvelope<unknown>> {
    return this.client.get<ApiEnvelope<unknown>>('/v1/wallet');
  }
}
