import type { TwitchClient } from './client';
import type { HelixListResponse, TwitchChatter, SendChatMessageResult } from '../types';

interface HelixChatterRaw {
  user_id: string;
  user_login: string;
  user_name: string;
}

interface SendMessageRaw {
  message_id?: string;
  is_sent?: boolean;
  drop_reason?: { code?: string; message?: string };
}

export class ChatApi {
  constructor(private readonly client: TwitchClient) {}

  async listChatters(
    broadcasterId: string,
    moderatorId: string,
    first = 50,
  ): Promise<{ total?: number; chatters: TwitchChatter[] }> {
    const limit = Math.min(1000, Math.max(1, first));
    const response = await this.client.request<HelixListResponse<HelixChatterRaw> & { total?: number }>(
      '/chat/chatters',
      {
        params: {
          broadcaster_id: broadcasterId,
          moderator_id: moderatorId,
          first: limit,
        },
      },
    );
    return {
      total: response.total,
      chatters: response.data.map((c) => ({
        userId: c.user_id,
        userLogin: c.user_login,
        userName: c.user_name,
      })),
    };
  }

  async sendChatMessage(
    broadcasterId: string,
    senderId: string,
    message: string,
  ): Promise<SendChatMessageResult> {
    const response = await this.client.request<HelixListResponse<SendMessageRaw>>('/chat/messages', {
      method: 'POST',
      body: {
        broadcaster_id: broadcasterId,
        sender_id: senderId,
        message,
      },
    });
    const result = response.data[0] ?? {};
    return {
      sent: result.is_sent ?? true,
      messageId: result.message_id ?? null,
      dropReason: result.drop_reason?.message ?? null,
    };
  }
}
