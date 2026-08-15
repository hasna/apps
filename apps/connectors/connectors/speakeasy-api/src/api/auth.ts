import type { ConnectorClient } from './client';
import type { ApiKeyDetails } from '../types';

export class AuthApi {
  constructor(private readonly client: ConnectorClient) {}

  validate(): Promise<ApiKeyDetails> {
    return this.client.get<ApiKeyDetails>('/v1/auth/validate');
  }
}
