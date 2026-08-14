import type { StytchClient } from './client';

export class TotpApi {
  constructor(private readonly client: StytchClient) {}

  async create(body: { user_id: string; expiration_minutes?: number }): Promise<Record<string, unknown>> {
    return this.client.post('/totps', body);
  }

  async authenticate(body: {
    user_id: string;
    totp_code: string;
    session_duration_minutes?: number;
    session_jwt?: string;
    session_token?: string;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/totps/authenticate', body);
  }

  async getRecoveryCodes(userId: string): Promise<Record<string, unknown>> {
    return this.client.get('/totps/recovery_codes', { user_id: userId });
  }

  async recover(body: {
    user_id: string;
    recovery_code: string;
    session_duration_minutes?: number;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/totps/recover', body);
  }
}
