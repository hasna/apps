import type {
  TidioConfig,
  Contact,
  Conversation,
  Message,
  Operator,
  Department,
  Tag,
  Automation,
  CannedResponse,
  Webhook,
  Project,
  ListContactsParams,
  CreateContactParams,
  UpdateContactParams,
  ListConversationsParams,
  ListMessagesParams,
  SendMessageParams,
  SetConversationStatusParams,
  AssignConversationParams,
  CreateTagParams,
  CreateCannedResponseParams,
  CreateWebhookParams,
} from '../types';
import { TidioClient } from './client';

export class Tidio {
  private readonly client: TidioClient;

  constructor(config: TidioConfig) {
    this.client = new TidioClient(config);
  }

  static fromEnv(): Tidio {
    const apiKey = process.env.TIDIO_API_KEY;
    if (!apiKey) {
      throw new Error('TIDIO_API_KEY environment variable is required');
    }
    return new Tidio({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): TidioClient {
    return this.client;
  }

  // Contacts
  async listContacts(params: ListContactsParams = {}): Promise<unknown> {
    return this.client.get('/contacts', {
      limit: params.limit,
      cursor: params.cursor,
      updated_after: params.updatedAfter,
      updated_before: params.updatedBefore,
    });
  }

  async getContact(id: string): Promise<Contact> {
    return this.client.get<Contact>(`/contacts/${encodeURIComponent(id)}`);
  }

  async createContact(params: CreateContactParams): Promise<Contact> {
    if (!params.email && !params.phone && !params.externalId) {
      throw new Error('createContact requires email, phone, or externalId');
    }
    return this.client.post<Contact>('/contacts', {
      email: params.email,
      phone: params.phone,
      name: params.name,
      external_id: params.externalId,
      tags: params.tags,
      properties: params.properties,
      subscriber: params.subscriber,
      consent: params.consent,
    });
  }

  async updateContact(id: string, params: UpdateContactParams): Promise<Contact> {
    const body = {
      email: params.email,
      phone: params.phone,
      name: params.name,
      external_id: params.externalId,
      tags: params.tags,
      properties: params.properties,
      subscriber: params.subscriber,
      consent: params.consent,
    };
    if (!Object.values(body).some(v => v !== undefined)) {
      throw new Error('updateContact requires at least one update field');
    }
    return this.client.patch<Contact>(`/contacts/${encodeURIComponent(id)}`, body);
  }

  async deleteContact(id: string): Promise<unknown> {
    return this.client.delete(`/contacts/${encodeURIComponent(id)}`);
  }

  // Conversations
  async listConversations(params: ListConversationsParams = {}): Promise<unknown> {
    return this.client.get('/conversations', {
      limit: params.limit,
      cursor: params.cursor,
      status: params.status,
      channel: params.channel,
      updated_after: params.updatedAfter,
    });
  }

  async getConversation(id: string): Promise<Conversation> {
    return this.client.get<Conversation>(`/conversations/${encodeURIComponent(id)}`);
  }

  async listConversationMessages(id: string, params: ListMessagesParams = {}): Promise<unknown> {
    return this.client.get(`/conversations/${encodeURIComponent(id)}/messages`, {
      limit: params.limit,
      cursor: params.cursor,
    });
  }

  async sendConversationMessage(id: string, params: SendMessageParams): Promise<Message> {
    return this.client.post<Message>(`/conversations/${encodeURIComponent(id)}/messages`, {
      type: params.type,
      content: params.content,
      media_url: params.mediaUrl,
      private: params.private,
      operator_id: params.operatorId,
    });
  }

  async setConversationStatus(id: string, params: SetConversationStatusParams): Promise<Conversation> {
    return this.client.patch<Conversation>(`/conversations/${encodeURIComponent(id)}/status`, {
      status: params.status,
      snoozed_until: params.snoozedUntil,
    });
  }

  async assignConversation(id: string, params: AssignConversationParams): Promise<Conversation> {
    return this.client.patch<Conversation>(`/conversations/${encodeURIComponent(id)}/assignment`, {
      operator_id: params.operatorId,
      department_id: params.departmentId,
    });
  }

  // Operators
  async listOperators(): Promise<unknown> {
    return this.client.get('/operators');
  }

  async getOperator(id: string): Promise<Operator> {
    return this.client.get<Operator>(`/operators/${encodeURIComponent(id)}`);
  }

  // Departments
  async listDepartments(): Promise<unknown> {
    return this.client.get('/departments');
  }

  // Tags
  async listTags(): Promise<unknown> {
    return this.client.get('/tags');
  }

  async createTag(params: CreateTagParams): Promise<Tag> {
    return this.client.post<Tag>('/tags', {
      name: params.name,
      color: params.color,
    });
  }

  async deleteTag(id: string): Promise<unknown> {
    return this.client.delete(`/tags/${encodeURIComponent(id)}`);
  }

  // Automations
  async listAutomations(): Promise<unknown> {
    return this.client.get('/automations');
  }

  // Canned responses
  async listCannedResponses(): Promise<unknown> {
    return this.client.get('/canned-responses');
  }

  async createCannedResponse(params: CreateCannedResponseParams): Promise<CannedResponse> {
    return this.client.post<CannedResponse>('/canned-responses', {
      shortcut: params.shortcut,
      content: params.content,
      department_id: params.departmentId,
    });
  }

  // Webhooks
  async listWebhooks(): Promise<unknown> {
    return this.client.get('/webhooks');
  }

  async createWebhook(params: CreateWebhookParams): Promise<Webhook> {
    return this.client.post<Webhook>('/webhooks', {
      url: params.url,
      events: params.events,
      secret: params.secret,
    });
  }

  async deleteWebhook(id: string): Promise<unknown> {
    return this.client.delete(`/webhooks/${encodeURIComponent(id)}`);
  }

  // Project
  async getProject(): Promise<Project> {
    return this.client.get<Project>('/project');
  }
}

export { TidioClient } from './client';
