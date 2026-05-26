import type { QuoClient } from './client';
import type { Conversation, ConversationListResponse, MessageListResponse } from '../types';

export interface ListConversationsOptions {
  phoneNumberId?: string;
  maxResults?: number;
  pageToken?: string;
}

/**
 * Conversations API module
 * List conversations and get conversation history
 */
export class ConversationsApi {
  constructor(private readonly client: QuoClient) {}

  /**
   * List conversations with optional filters
   */
  async list(options?: ListConversationsOptions): Promise<ConversationListResponse> {
    return this.client.get<ConversationListResponse>('/conversations', {
      phoneNumberId: options?.phoneNumberId,
      maxResults: options?.maxResults,
      pageToken: options?.pageToken,
    });
  }

  /**
   * Get a conversation by ID
   */
  async get(conversationId: string): Promise<{ data: Conversation }> {
    return this.client.get<{ data: Conversation }>(`/conversations/${conversationId}`);
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId: string, options?: { maxResults?: number; pageToken?: string }): Promise<MessageListResponse> {
    return this.client.get<MessageListResponse>('/messages', {
      conversationId,
      maxResults: options?.maxResults,
      pageToken: options?.pageToken,
    });
  }
}
