// Rocket.Chat Connector — Open-source team messaging and collaboration
import { RocketChatClient } from './client';
import type { RocketChatConfig, RCUser, RCChannel, RCMessage, RCMessageList } from '../types';
export { RocketChatClient } from './client';

export class RocketChat {
  private readonly client: RocketChatClient;
  constructor(config: RocketChatConfig) { this.client = new RocketChatClient(config); }
  static fromEnv(): RocketChat {
    const url = process.env.ROCKETCHAT_URL;
    const authToken = process.env.ROCKETCHAT_AUTH_TOKEN;
    const userId = process.env.ROCKETCHAT_USER_ID;
    if (!url || !authToken || !userId) throw new Error('ROCKETCHAT_URL, ROCKETCHAT_AUTH_TOKEN, and ROCKETCHAT_USER_ID are required');
    return new RocketChat({ url, authToken, userId });
  }

  async getMe(): Promise<RCUser> { return this.client.request<RCUser>('/me'); }
  async listUsers(options?: { count?: number; offset?: number }): Promise<{ users: RCUser[]; total: number }> {
    return this.client.request('/users.list', { params: { count: options?.count, offset: options?.offset } });
  }

  async listChannels(options?: { count?: number; offset?: number }): Promise<{ channels: RCChannel[]; total: number }> {
    return this.client.request('/channels.list', { params: { count: options?.count, offset: options?.offset } });
  }
  async getChannelInfo(roomId: string): Promise<{ channel: RCChannel }> { return this.client.request('/channels.info', { params: { roomId } }); }
  async createChannel(name: string, members?: string[]): Promise<{ channel: RCChannel }> {
    return this.client.request('/channels.create', { method: 'POST', body: { name, members } as Record<string, unknown> });
  }

  async sendMessage(roomId: string, text: string): Promise<{ message: RCMessage }> {
    return this.client.request('/chat.sendMessage', { method: 'POST', body: { message: { rid: roomId, msg: text } } });
  }
  async getMessages(roomId: string, options?: { count?: number; offset?: number }): Promise<RCMessageList> {
    return this.client.request<RCMessageList>('/channels.history', { params: { roomId, count: options?.count, offset: options?.offset } });
  }
  async deleteMessage(msgId: string, roomId: string): Promise<void> {
    await this.client.request('/chat.delete', { method: 'POST', body: { msgId, roomId } });
  }

  async searchMessages(roomId: string, searchText: string): Promise<RCMessageList> {
    return this.client.request<RCMessageList>('/chat.search', { params: { roomId, searchText } });
  }

  async setStatus(status: string, message?: string): Promise<void> {
    await this.client.request('/users.setStatus', { method: 'POST', body: { status, message } });
  }

  getClient(): RocketChatClient { return this.client; }
}
