import type { TimelinesAIClient } from './client';
import type {
  ChatInfoResponse,
  ChatListResponse,
  ChatUpdateInput,
  ListChatsParams,
} from '../types';

export class ChatsApi {
  constructor(private readonly client: TimelinesAIClient) {}

  list(params?: ListChatsParams): Promise<ChatListResponse> {
    return this.client.get<ChatListResponse>('/chats', params as Record<string, string | number | boolean | undefined>);
  }

  get(chatId: string | number): Promise<ChatInfoResponse> {
    const encoded = this.client.encodePathSegment(chatId);
    return this.client.get<ChatInfoResponse>(`/chats/${encoded}`);
  }

  update(chatId: string | number, input: ChatUpdateInput): Promise<ChatInfoResponse> {
    const encoded = this.client.encodePathSegment(chatId);
    return this.client.patch<ChatInfoResponse>(`/chats/${encoded}`, input as Record<string, unknown>);
  }
}
