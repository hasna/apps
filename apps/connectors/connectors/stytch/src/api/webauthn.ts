import type { StytchClient } from './client';

export class WebauthnApi {
  constructor(private readonly client: StytchClient) {}

  async registerStart(body: {
    user_id: string;
    domain: string;
    user_agent?: string;
    authenticator_type?: 'platform' | 'cross_platform';
  }): Promise<Record<string, unknown>> {
    return this.client.post('/webauthn/register/start', body);
  }

  async authenticateStart(body: { user_id: string; domain: string }): Promise<Record<string, unknown>> {
    return this.client.post('/webauthn/authenticate/start', body);
  }
}
