import type { TimelinesAIClient } from './client';
import type { WhatsappAccountsResponse } from '../types';

export class WhatsappAccountsApi {
  constructor(private readonly client: TimelinesAIClient) {}

  list(): Promise<WhatsappAccountsResponse> {
    return this.client.get<WhatsappAccountsResponse>('/whatsapp_accounts');
  }
}
