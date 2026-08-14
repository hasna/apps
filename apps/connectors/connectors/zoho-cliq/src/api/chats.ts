import type { ZohoCliqClient } from './client';
import type { ZohoCliqChat, ZohoCliqChatType } from '../types';

export class ChatsApi {
  constructor(private readonly client: ZohoCliqClient) {}

  async list(options?: {
    limit?: number;
    offset?: number;
    type?: ZohoCliqChatType;
  }): Promise<unknown> {
    return this.client.get('/chats', {
      limit: options?.limit,
      offset: options?.offset,
      type: options?.type,
    });
  }

  async get(id: string): Promise<ZohoCliqChat> {
    return this.client.get<ZohoCliqChat>(`/chats/${encodeURIComponent(id)}`);
  }

  async createGroup(options: {
    title: string;
    userIds: string[];
    emails?: string[];
  }): Promise<unknown> {
    return this.client.post('/chats', {
      type: 'groupchat',
      title: options.title,
      user_ids: options.userIds,
      emails: options.emails,
    });
  }
}
