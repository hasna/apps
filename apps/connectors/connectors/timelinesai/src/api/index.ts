import { TimelinesAIClient } from './client';
import { ChatsApi } from './chats';
import { MessagesApi } from './messages';
import { WhatsappAccountsApi } from './whatsapp-accounts';
import type { TimelinesAIConfig } from '../types';

export { TimelinesAIClient, DEFAULT_BASE_URL } from './client';
export { ChatsApi } from './chats';
export { MessagesApi } from './messages';
export { WhatsappAccountsApi } from './whatsapp-accounts';

export class TimelinesAI {
  readonly client: TimelinesAIClient;
  readonly chats: ChatsApi;
  readonly messages: MessagesApi;
  readonly whatsappAccounts: WhatsappAccountsApi;

  constructor(config: TimelinesAIConfig) {
    this.client = new TimelinesAIClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
    this.chats = new ChatsApi(this.client);
    this.messages = new MessagesApi(this.client);
    this.whatsappAccounts = new WhatsappAccountsApi(this.client);
  }

  static fromEnv(): TimelinesAI {
    const apiKey = process.env.TIMELINESAI_API_KEY;
    if (!apiKey) {
      throw new Error('TIMELINESAI_API_KEY environment variable is required');
    }
    return new TimelinesAI({
      apiKey,
      baseUrl: process.env.TIMELINESAI_BASE_URL,
    });
  }

  async rawRequest(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown>;
    } = {}
  ): Promise<unknown> {
    return this.client.request(path, options);
  }
}
