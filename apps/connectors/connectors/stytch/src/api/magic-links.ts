import type { StytchClient } from './client';

export class MagicLinksApi {
  constructor(private readonly client: StytchClient) {}

  async sendByEmail(body: {
    email: string;
    login_magic_link_url?: string;
    signup_magic_link_url?: string;
    login_template_id?: string;
    signup_template_id?: string;
    login_expiration_minutes?: number;
    signup_expiration_minutes?: number;
    attributes?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/magic_links/email/send', body);
  }

  async loginOrCreate(body: {
    email: string;
    login_magic_link_url?: string;
    signup_magic_link_url?: string;
    login_template_id?: string;
    signup_template_id?: string;
    create_user_as_pending?: boolean;
    attributes?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/magic_links/email/login_or_create', body);
  }

  async authenticate(body: {
    token: string;
    session_duration_minutes?: number;
    session_jwt?: string;
    session_token?: string;
    session_custom_claims?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/magic_links/authenticate', body);
  }
}
