// Missive Connector
// Collaborative email and chat — conversations, messages, contacts

import { MissiveClient } from './client';
import type {
  MissiveConfig,
  MissiveConversation,
  MissiveMessage,
  MissiveContact,
  MissiveUser,
  SendMessageOptions,
} from '../types';

export { MissiveClient } from './client';

export class Missive {
  private readonly client: MissiveClient;

  constructor(config: MissiveConfig) {
    this.client = new MissiveClient(config);
  }

  static fromEnv(): Missive {
    const apiKey = process.env.MISSIVE_API_KEY;
    if (!apiKey) throw new Error('MISSIVE_API_KEY environment variable is required');
    return new Missive({ apiKey });
  }

  // ============================================
  // Conversations
  // ============================================

  async listConversations(options?: {
    label?: string;
    assignedToMe?: boolean;
    unread?: boolean;
    limit?: number;
    pageToken?: string;
  }): Promise<{ conversations: MissiveConversation[]; next_page_token: string | null }> {
    return this.client.get('/conversations', {
      label: options?.label,
      assigned_to_me: options?.assignedToMe,
      unread: options?.unread,
      limit: options?.limit,
      page_token: options?.pageToken,
    });
  }

  async getConversation(conversationId: string): Promise<{ conversation: MissiveConversation }> {
    return this.client.get(`/conversations/${conversationId}`);
  }

  async closeConversation(conversationId: string): Promise<void> {
    await this.client.post(`/conversations/${conversationId}/close`);
  }

  async reopenConversation(conversationId: string): Promise<void> {
    await this.client.post(`/conversations/${conversationId}/reopen`);
  }

  async trashConversation(conversationId: string): Promise<void> {
    await this.client.post(`/conversations/${conversationId}/trash`);
  }

  async assignConversation(conversationId: string, options: {
    userIds?: string[];
    teamIds?: string[];
  }): Promise<void> {
    await this.client.post(`/conversations/${conversationId}/assign`, {
      assignee_users: options.userIds?.map(id => ({ id })),
      assignee_teams: options.teamIds?.map(id => ({ id })),
    });
  }

  // ============================================
  // Messages
  // ============================================

  async listMessages(conversationId: string): Promise<{ messages: MissiveMessage[] }> {
    return this.client.get(`/conversations/${conversationId}/messages`);
  }

  async getMessage(messageId: string): Promise<{ message: MissiveMessage }> {
    return this.client.get(`/messages/${messageId}`);
  }

  async sendMessage(options: SendMessageOptions): Promise<{ message: MissiveMessage }> {
    return this.client.post('/messages', {
      messages: [{
        from_field: options.fromField,
        to_fields: options.toFields,
        cc_fields: options.ccFields,
        subject: options.subject,
        markdown: options.markdown,
        html: options.html,
        add_to_shared_labels: options.addToSharedLabels?.map(name => ({ name })),
        assignee_users: options.assignToUsers?.map(id => ({ id })),
        assignee_teams: options.assignToTeams?.map(id => ({ id })),
        conversation_subject: options.conversationSubject,
        external_id: options.externalId,
      }],
    });
  }

  // ============================================
  // Contacts
  // ============================================

  async listContacts(options?: {
    search?: string;
    limit?: number;
    pageToken?: string;
  }): Promise<{ contacts: MissiveContact[]; next_page_token: string | null }> {
    return this.client.get('/contacts', {
      search: options?.search,
      limit: options?.limit,
      page_token: options?.pageToken,
    });
  }

  async getContact(contactId: string): Promise<{ contact: MissiveContact }> {
    return this.client.get(`/contacts/${contactId}`);
  }

  async createContact(data: {
    name: string;
    emails?: Array<{ address: string; label?: string }>;
    phones?: Array<{ number: string; label?: string }>;
    company?: string;
  }): Promise<{ contact: MissiveContact }> {
    return this.client.post('/contacts', data as Record<string, unknown>);
  }

  // ============================================
  // Users & Teams
  // ============================================

  async listUsers(): Promise<{ users: MissiveUser[] }> {
    return this.client.get('/users');
  }

  getClient(): MissiveClient {
    return this.client;
  }
}
