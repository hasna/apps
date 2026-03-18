// Zulip Connector — Open-source team chat with threaded conversations
import { ZulipClient } from './client';
import type { ZulipConfig, ZulipMessage, ZulipStream, ZulipUser, ZulipTopic } from '../types';
export { ZulipClient } from './client';

export class Zulip {
  private readonly client: ZulipClient;
  constructor(config: ZulipConfig) { this.client = new ZulipClient(config); }
  static fromEnv(): Zulip {
    const email = process.env.ZULIP_EMAIL;
    const apiKey = process.env.ZULIP_API_KEY;
    const serverUrl = process.env.ZULIP_SERVER_URL;
    if (!email || !apiKey || !serverUrl) throw new Error('ZULIP_EMAIL, ZULIP_API_KEY, and ZULIP_SERVER_URL are required');
    return new Zulip({ email, apiKey, serverUrl });
  }

  async sendMessage(type: 'stream' | 'private', to: string | number[], content: string, options?: { topic?: string }): Promise<{ id: number }> {
    return this.client.request('/messages', { method: 'POST', body: { type, to: Array.isArray(to) ? JSON.stringify(to) : to, content, topic: options?.topic } });
  }
  async getMessages(options: { anchor?: string | number; num_before?: number; num_after?: number; narrow?: string }): Promise<{ messages: ZulipMessage[] }> {
    return this.client.request('/messages', { params: options as Record<string, string | number | undefined> });
  }
  async updateMessage(messageId: number, data: { content?: string; topic?: string }): Promise<void> {
    await this.client.request(`/messages/${messageId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteMessage(messageId: number): Promise<void> { await this.client.request(`/messages/${messageId}`, { method: 'DELETE' }); }

  async listStreams(): Promise<ZulipStream[]> { const r = await this.client.request<{ streams: ZulipStream[] }>('/streams'); return r.streams ?? []; }
  async getStreamTopics(streamId: number): Promise<ZulipTopic[]> { const r = await this.client.request<{ topics: ZulipTopic[] }>(`/users/me/${streamId}/topics`); return r.topics ?? []; }
  async subscribe(subscriptions: Array<{ name: string; description?: string }>): Promise<void> {
    await this.client.request('/users/me/subscriptions', { method: 'POST', body: { subscriptions: JSON.stringify(subscriptions) } });
  }
  async unsubscribe(subscriptions: string[]): Promise<void> {
    await this.client.request('/users/me/subscriptions', { method: 'DELETE', body: { subscriptions: JSON.stringify(subscriptions) } });
  }

  async listUsers(): Promise<ZulipUser[]> { const r = await this.client.request<{ members: ZulipUser[] }>('/users'); return r.members ?? []; }
  async getUser(userId: number): Promise<ZulipUser> { const r = await this.client.request<{ user: ZulipUser }>(`/users/${userId}`); return r.user; }
  async getMe(): Promise<ZulipUser> { const r = await this.client.request<{ user: ZulipUser }>('/users/me'); return r.user ?? (r as unknown as ZulipUser); }

  getClient(): ZulipClient { return this.client; }
}
