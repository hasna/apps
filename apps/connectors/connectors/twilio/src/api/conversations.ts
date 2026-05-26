import type { TwilioClient } from './client';
import type {
  Conversation,
  ConversationListResponse,
  ConversationMessage,
  ConversationParticipant,
  CreateConversationParams,
  UpdateConversationParams,
  AddParticipantParams,
  SendConversationMessageParams,
} from '../types';

const CONVERSATIONS_BASE_URL = 'https://conversations.twilio.com/v1';

/**
 * Twilio Conversations API
 * Create and manage conversations, participants, and messages
 */
export class ConversationsApi {
  private readonly baseUrl = CONVERSATIONS_BASE_URL;

  constructor(private readonly client: TwilioClient) {}

  /**
   * Make a request to the Conversations API (different base URL)
   */
  private async conversationsRequest<T>(method: string, path: string, body?: Record<string, unknown>, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const credentials = Buffer.from(`${this.client.getAccountSid()}:${(this.client as unknown as { authToken: string }).authToken}`).toString('base64');

    const headers: Record<string, string> = {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const formParams = new URLSearchParams();
      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (typeof value === 'object') {
            formParams.append(key, JSON.stringify(value));
          } else {
            formParams.append(key, String(value));
          }
        }
      });
      fetchOptions.body = formParams.toString();
      fetchOptions.headers = headers;
    }

    const response = await fetch(url, fetchOptions);

    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || response.statusText);
    }

    return data as T;
  }

  // ============================================
  // Conversations
  // ============================================

  /**
   * Create a new conversation
   */
  async create(params?: CreateConversationParams): Promise<Conversation> {
    return this.conversationsRequest<Conversation>(
      'POST',
      '/Conversations',
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * List all conversations
   */
  async list(params?: { PageSize?: number; Page?: number; State?: string }): Promise<ConversationListResponse> {
    return this.conversationsRequest<ConversationListResponse>(
      'GET',
      '/Conversations',
      undefined,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get a conversation by SID or UniqueName
   */
  async get(conversationSid: string): Promise<Conversation> {
    return this.conversationsRequest<Conversation>(
      'GET',
      `/Conversations/${conversationSid}`
    );
  }

  /**
   * Update a conversation
   */
  async update(conversationSid: string, params: UpdateConversationParams): Promise<Conversation> {
    return this.conversationsRequest<Conversation>(
      'POST',
      `/Conversations/${conversationSid}`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * Delete a conversation
   */
  async delete(conversationSid: string): Promise<void> {
    await this.conversationsRequest<void>(
      'DELETE',
      `/Conversations/${conversationSid}`
    );
  }

  /**
   * Close a conversation
   */
  async close(conversationSid: string): Promise<Conversation> {
    return this.update(conversationSid, { State: 'closed' });
  }

  // ============================================
  // Participants
  // ============================================

  /**
   * Add a participant to a conversation
   */
  async addParticipant(conversationSid: string, params: AddParticipantParams): Promise<ConversationParticipant> {
    return this.conversationsRequest<ConversationParticipant>(
      'POST',
      `/Conversations/${conversationSid}/Participants`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * List participants in a conversation
   */
  async listParticipants(conversationSid: string, params?: { PageSize?: number; Page?: number }): Promise<{ participants: ConversationParticipant[]; meta: { page: number; page_size: number } }> {
    return this.conversationsRequest(
      'GET',
      `/Conversations/${conversationSid}/Participants`,
      undefined,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get a participant by SID
   */
  async getParticipant(conversationSid: string, participantSid: string): Promise<ConversationParticipant> {
    return this.conversationsRequest<ConversationParticipant>(
      'GET',
      `/Conversations/${conversationSid}/Participants/${participantSid}`
    );
  }

  /**
   * Update a participant
   */
  async updateParticipant(conversationSid: string, participantSid: string, params: {
    DateCreated?: string;
    DateUpdated?: string;
    Attributes?: string;
    RoleSid?: string;
    'MessagingBinding.ProxyAddress'?: string;
    'MessagingBinding.ProjectedAddress'?: string;
    LastReadMessageIndex?: number;
    LastReadTimestamp?: string;
  }): Promise<ConversationParticipant> {
    return this.conversationsRequest<ConversationParticipant>(
      'POST',
      `/Conversations/${conversationSid}/Participants/${participantSid}`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * Remove a participant from a conversation
   */
  async removeParticipant(conversationSid: string, participantSid: string): Promise<void> {
    await this.conversationsRequest<void>(
      'DELETE',
      `/Conversations/${conversationSid}/Participants/${participantSid}`
    );
  }

  // ============================================
  // Messages
  // ============================================

  /**
   * Send a message to a conversation
   */
  async sendMessage(conversationSid: string, params: SendConversationMessageParams): Promise<ConversationMessage> {
    return this.conversationsRequest<ConversationMessage>(
      'POST',
      `/Conversations/${conversationSid}/Messages`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * List messages in a conversation
   */
  async listMessages(conversationSid: string, params?: { PageSize?: number; Page?: number; Order?: 'asc' | 'desc' }): Promise<{ messages: ConversationMessage[]; meta: { page: number; page_size: number } }> {
    return this.conversationsRequest(
      'GET',
      `/Conversations/${conversationSid}/Messages`,
      undefined,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get a message by SID
   */
  async getMessage(conversationSid: string, messageSid: string): Promise<ConversationMessage> {
    return this.conversationsRequest<ConversationMessage>(
      'GET',
      `/Conversations/${conversationSid}/Messages/${messageSid}`
    );
  }

  /**
   * Update a message
   */
  async updateMessage(conversationSid: string, messageSid: string, params: {
    Author?: string;
    Body?: string;
    DateCreated?: string;
    DateUpdated?: string;
    Attributes?: string;
  }): Promise<ConversationMessage> {
    return this.conversationsRequest<ConversationMessage>(
      'POST',
      `/Conversations/${conversationSid}/Messages/${messageSid}`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * Delete a message
   */
  async deleteMessage(conversationSid: string, messageSid: string): Promise<void> {
    await this.conversationsRequest<void>(
      'DELETE',
      `/Conversations/${conversationSid}/Messages/${messageSid}`
    );
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * Add a chat user to a conversation by identity
   */
  async addChatParticipant(conversationSid: string, identity: string, attributes?: string): Promise<ConversationParticipant> {
    return this.addParticipant(conversationSid, {
      Identity: identity,
      Attributes: attributes,
    });
  }

  /**
   * Add an SMS participant to a conversation
   */
  async addSmsParticipant(conversationSid: string, address: string, proxyAddress: string, attributes?: string): Promise<ConversationParticipant> {
    return this.addParticipant(conversationSid, {
      'MessagingBinding.Address': address,
      'MessagingBinding.ProxyAddress': proxyAddress,
      Attributes: attributes,
    });
  }

  /**
   * Send a text message to a conversation
   */
  async sendText(conversationSid: string, body: string, author?: string): Promise<ConversationMessage> {
    return this.sendMessage(conversationSid, { Body: body, Author: author });
  }
}
