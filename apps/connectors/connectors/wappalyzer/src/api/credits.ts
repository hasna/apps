import type { CreditsBalance } from '../types';
import type { ConnectorClient } from './client';

export class CreditsApi {
  constructor(private readonly client: ConnectorClient) {}

  async balance(): Promise<CreditsBalance> {
    return this.client.get<CreditsBalance>('/credits/balance/');
  }
}
