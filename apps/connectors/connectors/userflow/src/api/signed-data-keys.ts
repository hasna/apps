import type { UserflowClient } from './client';
import { encodeResourceId } from './helpers';

export class SignedDataKeysApi {
  constructor(private readonly client: UserflowClient) {}

  async listSignedDataKeys(): Promise<unknown> {
    return this.client.get('/v2/signed_data_keys');
  }

  async createSignedDataKey(options: { name: string }): Promise<unknown> {
    return this.client.post('/v2/signed_data_keys', options);
  }

  async deleteSignedDataKey(id: string): Promise<unknown> {
    return this.client.delete(`/v2/signed_data_keys/${encodeResourceId(id)}`);
  }
}
