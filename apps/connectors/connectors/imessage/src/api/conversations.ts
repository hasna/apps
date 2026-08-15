import type { ImessageClient } from './client';
import type { IMessageConversation } from '../types';

export interface ListConversationsOptions {
  limit?: number;
  offset?: number;
}

/**
 * Conversation API module - list and retrieve iMessage conversations
 */
export class ConversationsApi {
  constructor(private readonly client: ImessageClient) {}

  /**
   * List all conversations
   */
  async list(options: ListConversationsOptions = {}): Promise<IMessageConversation[]> {
    const params: Record<string, number | undefined> = {};
    if (options.limit) params.limit = options.limit;
    if (options.offset) params.offset = options.offset;
    return this.client.get<IMessageConversation[]>('/conversations', params);
  }

  /**
   * Iterate over all conversations (handles pagination)
   */
  async *listAll(options: ListConversationsOptions = {}): AsyncGenerator<IMessageConversation> {
    let offset = options.offset || 0;
    const limit = options.limit || 50;

    while (true) {
      const conversations = await this.list({ limit, offset });
      if (conversations.length === 0) break;
      for (const conversation of conversations) {
        yield conversation;
      }
      if (conversations.length < limit) break;
      offset += conversations.length;
    }
  }

  /**
   * Get a specific conversation by chat GUID
   */
  async get(chatGuid: string): Promise<IMessageConversation> {
    return this.client.get<IMessageConversation>(`/conversations/${encodeURIComponent(chatGuid)}`);
  }
}
