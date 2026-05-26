import type { ConnectorClient } from './client';
import type { Message, MessageCreateParams, ListParams } from '../types';

export class MessagesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    return this.client.get<unknown>('/messages', queryParams);
  }

  async get(messageId: string): Promise<Message> {
    return this.client.get<Message>(`/messages/${messageId}`);
  }

  async create(params: MessageCreateParams): Promise<Message> {
    return this.client.post<Message>('/messages', params);
  }

  async update(messageId: string, params: Partial<MessageCreateParams>): Promise<Message> {
    return this.client.put<Message>(`/messages/${messageId}`, params);
  }
}
