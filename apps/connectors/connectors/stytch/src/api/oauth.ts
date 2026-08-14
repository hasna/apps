import type { StytchClient } from './client';

export class OAuthApi {
  constructor(private readonly client: StytchClient) {}

  async attach(body: {
    user_id?: string;
    session_jwt?: string;
    session_token?: string;
    provider: string;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/oauth/attach', body);
  }

  async authenticate(body: {
    token: string;
    session_duration_minutes?: number;
    session_jwt?: string;
    session_token?: string;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/oauth/authenticate', body);
  }
}
