import type { StytchClient } from './client';

export class OtpApi {
  constructor(private readonly client: StytchClient) {}

  async sendEmail(body: {
    email: string;
    expiration_minutes?: number;
    locale?: string;
    attributes?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/otps/email/send', body);
  }

  async loginOrCreateEmail(body: {
    email: string;
    expiration_minutes?: number;
    create_user_as_pending?: boolean;
    attributes?: Record<string, unknown>;
    locale?: string;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/otps/email/login_or_create', body);
  }

  async sendSms(body: {
    phone_number: string;
    expiration_minutes?: number;
    locale?: string;
    attributes?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/otps/sms/send', body);
  }

  async loginOrCreateSms(body: {
    phone_number: string;
    expiration_minutes?: number;
    create_user_as_pending?: boolean;
    attributes?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/otps/sms/login_or_create', body);
  }

  async sendWhatsapp(body: {
    phone_number: string;
    expiration_minutes?: number;
    locale?: string;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/otps/whatsapp/send', body);
  }

  async authenticate(body: {
    method_id: string;
    code: string;
    session_duration_minutes?: number;
    session_jwt?: string;
    session_token?: string;
    session_custom_claims?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return this.client.post('/otps/authenticate', body);
  }
}
