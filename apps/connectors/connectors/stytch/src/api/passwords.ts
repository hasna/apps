import type { StytchClient } from './client';

export class PasswordsApi {
  constructor(private readonly client: StytchClient) {}

  async create(body: {
    email: string;
    password: string;
    session_duration_minutes?: number;
    name?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/passwords', body);
  }

  async authenticate(body: {
    email: string;
    password: string;
    session_duration_minutes?: number;
    session_jwt?: string;
    session_token?: string;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/passwords/authenticate', body);
  }

  async resetByEmailStart(body: {
    email: string;
    reset_password_redirect_url?: string;
    reset_password_template_id?: string;
    reset_password_expiration_minutes?: number;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/passwords/email/reset/start', body);
  }

  async resetByEmail(body: {
    token: string;
    password: string;
    session_duration_minutes?: number;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/passwords/email/reset', body);
  }

  async resetSession(body: {
    password: string;
    session_token?: string;
    session_jwt?: string;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/passwords/session/reset', body);
  }

  async migrate(body: {
    email: string;
    hash: string;
    hash_type: 'bcrypt' | 'md_5' | 'argon_2i' | 'argon_2id' | 'scrypt' | 'sha_1' | 'phpass';
    md_5_config?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/passwords/migrate', body);
  }
}
