import type { UserDeletePayload, UserIdentifyPayload } from '../types';
import type { ConnectorClient } from './client';

export class UsersApi {
  constructor(private readonly client: ConnectorClient) {}

  identify(payload: UserIdentifyPayload): Promise<void> {
    return this.client.post('/users', payload as unknown as Record<string, unknown>);
  }

  delete(payload: UserDeletePayload): Promise<void> {
    return this.client.delete('/users', payload as unknown as Record<string, unknown>);
  }
}
