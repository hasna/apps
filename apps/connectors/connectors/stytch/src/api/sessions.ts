import type { StytchClient } from './client';
import type { StytchSession } from '../types';

export class SessionsApi {
  constructor(private readonly client: StytchClient) {}

  async list(userId: string): Promise<{ sessions: StytchSession[]; request_id?: string }> {
    return this.client.get('/sessions', { user_id: userId });
  }

  async authenticate(body: {
    session_token?: string;
    session_jwt?: string;
    session_duration_minutes?: number;
    session_custom_claims?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/sessions/authenticate', body);
  }

  async revoke(body: {
    session_id?: string;
    session_token?: string;
    session_jwt?: string;
    user_id?: string;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/sessions/revoke', body);
  }
}
