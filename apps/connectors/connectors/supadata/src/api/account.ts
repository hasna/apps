import type { SupadataClient } from './client';
import type { AccountInfo } from '../types';

export class AccountApi {
  constructor(private readonly client: SupadataClient) {}

  async me(): Promise<AccountInfo> {
    return this.client.get<AccountInfo>('/me');
  }
}
