import type { StytchClient } from './client';
import type { StytchSearchResponse, StytchUser } from '../types';

export class UsersApi {
  constructor(private readonly client: StytchClient) {}

  async search(options: { limit?: number; cursor?: string; query?: Record<string, unknown> } = {}): Promise<StytchSearchResponse<StytchUser>> {
    return this.client.post('/users/search', {
      limit: options.limit,
      cursor: options.cursor,
      query: options.query,
    });
  }

  async get(userId: string): Promise<{ user: StytchUser; request_id?: string }> {
    return this.client.get(`/users/${encodeURIComponent(userId)}`);
  }

  async create(body: {
    email?: string;
    phone_number?: string;
    name?: { first_name?: string; middle_name?: string; last_name?: string };
    create_user_as_pending?: boolean;
    attributes?: Record<string, unknown>;
    trusted_metadata?: Record<string, unknown>;
    untrusted_metadata?: Record<string, unknown>;
  }): Promise<{ user: StytchUser; request_id?: string }> {
    return this.client.post('/users', body);
  }

  async update(
    userId: string,
    body: {
      name?: Record<string, unknown>;
      attributes?: Record<string, unknown>;
      trusted_metadata?: Record<string, unknown>;
      untrusted_metadata?: Record<string, unknown>;
      emails?: Array<Record<string, unknown>>;
      phone_numbers?: Array<Record<string, unknown>>;
      crypto_wallets?: Array<Record<string, unknown>>;
    },
  ): Promise<{ user: StytchUser; request_id?: string }> {
    return this.client.put(`/users/${encodeURIComponent(userId)}`, body);
  }

  async delete(userId: string): Promise<{ request_id?: string }> {
    return this.client.delete(`/users/${encodeURIComponent(userId)}`);
  }

  async deleteEmail(emailId: string): Promise<{ request_id?: string }> {
    return this.client.delete(`/users/emails/${encodeURIComponent(emailId)}`);
  }

  async deletePhoneNumber(phoneId: string): Promise<{ request_id?: string }> {
    return this.client.delete(`/users/phone_numbers/${encodeURIComponent(phoneId)}`);
  }
}
