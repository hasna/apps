import type { ZohoCliqClient } from './client';
import type { MessageCardOptions } from '../types';

function messageBody(options: MessageCardOptions): Record<string, unknown> {
  return {
    text: options.text,
    bot: options.bot,
    card: options.card,
    slides: options.slides,
    buttons: options.buttons,
  };
}

export class MessagesApi {
  constructor(private readonly client: ZohoCliqClient) {}

  async sendToChannelByName(channelName: string, options: MessageCardOptions): Promise<unknown> {
    return this.client.post(
      `/channelsbyname/${encodeURIComponent(channelName)}/message`,
      messageBody(options)
    );
  }

  async sendToChannel(channelId: string, options: MessageCardOptions): Promise<unknown> {
    return this.client.post(
      `/channels/${encodeURIComponent(channelId)}/message`,
      messageBody(options)
    );
  }

  async sendToChat(chatId: string, options: MessageCardOptions): Promise<unknown> {
    return this.client.post(
      `/chats/${encodeURIComponent(chatId)}/message`,
      messageBody(options)
    );
  }

  async edit(chatId: string, messageId: string, text: string): Promise<unknown> {
    return this.client.put(
      `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
      { text }
    );
  }

  async delete(chatId: string, messageId: string): Promise<unknown> {
    return this.client.delete(
      `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`
    );
  }

  async list(chatId: string, options?: { limit?: number; from?: string }): Promise<unknown> {
    return this.client.get(`/chats/${encodeURIComponent(chatId)}/messages`, {
      limit: options?.limit,
      from: options?.from,
    });
  }

  async pin(chatId: string, messageId: string): Promise<unknown> {
    return this.client.post(
      `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/pin`
    );
  }

  async unpin(chatId: string, messageId: string): Promise<unknown> {
    return this.client.delete(
      `/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/pin`
    );
  }
}
