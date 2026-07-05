import type { WebexClient } from './client';
import type {
  PaginatedResponse,
  WebexMessage,
  WebexMessageCreateRequest,
  ListMessagesOptions,
} from '../types';

export class MessagesApi {
  constructor(private readonly client: WebexClient) {}

  async list(options: ListMessagesOptions): Promise<WebexMessage[]> {
    const response = await this.client.get<PaginatedResponse<WebexMessage>>('/messages', {
      roomId: options.roomId,
      parentId: options.parentId,
      mentionedPeople: options.mentionedPeople,
      before: options.before,
      beforeMessage: options.beforeMessage,
      max: options.max,
    });
    return response.items ?? [];
  }

  async get(messageId: string): Promise<WebexMessage> {
    return this.client.get<WebexMessage>(`/messages/${encodeURIComponent(messageId)}`);
  }

  async create(message: WebexMessageCreateRequest): Promise<WebexMessage> {
    return this.client.post<WebexMessage>('/messages', message);
  }

  async delete(messageId: string): Promise<void> {
    await this.client.delete(`/messages/${encodeURIComponent(messageId)}`);
  }
}
