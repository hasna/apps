import type { TimelinesAIClient } from './client';
import type {
  ListChatMessagesParams,
  MessageListResponse,
  MessagePayload,
  MessageSendResponse,
  MessageToPhoneInput,
} from '../types';

export class MessagesApi {
  constructor(private readonly client: TimelinesAIClient) {}

  sendToPhone(input: MessageToPhoneInput): Promise<MessageSendResponse> {
    return this.client.post<MessageSendResponse>('/messages', input as unknown as Record<string, unknown>);
  }

  sendToChat(chatId: string | number, input: MessagePayload): Promise<MessageSendResponse> {
    const encoded = this.client.encodePathSegment(chatId);
    return this.client.post<MessageSendResponse>(
      `/chats/${encoded}/messages`,
      input as unknown as Record<string, unknown>
    );
  }

  listForChat(chatId: string | number, params?: ListChatMessagesParams): Promise<MessageListResponse> {
    const encoded = this.client.encodePathSegment(chatId);
    return this.client.get<MessageListResponse>(
      `/chats/${encoded}/messages`,
      params as Record<string, string | number | boolean | undefined>
    );
  }
}
