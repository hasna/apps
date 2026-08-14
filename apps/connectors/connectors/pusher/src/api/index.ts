// Pusher Connector — Realtime messaging and channels
import { PusherClient } from './client';
import type { PusherConfig, PusherChannel, PusherChannelInfo, PusherUser, PusherBatchEvent } from '../types';
export { PusherClient } from './client';

export class Pusher {
  private readonly client: PusherClient;
  constructor(config: PusherConfig) { this.client = new PusherClient(config); }
  static fromEnv(): Pusher {
    const appId = process.env.PUSHER_APP_ID;
    const key = process.env.PUSHER_KEY;
    const secret = process.env.PUSHER_SECRET;
    const cluster = process.env.PUSHER_CLUSTER;
    if (!appId || !key || !secret || !cluster) throw new Error('PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, and PUSHER_CLUSTER are required');
    return new Pusher({ appId, key, secret, cluster });
  }

  async trigger(channel: string, event: string, data: unknown, socketId?: string): Promise<void> {
    await this.client.request('/events', { method: 'POST', body: { name: event, channel, data: JSON.stringify(data), socket_id: socketId } as Record<string, unknown> });
  }

  async triggerBatch(events: PusherBatchEvent[]): Promise<void> {
    await this.client.request('/batch_events', { method: 'POST', body: { batch: events } as Record<string, unknown> });
  }

  async listChannels(options?: { filter_by_prefix?: string; info?: string }): Promise<{ channels: Record<string, PusherChannel> }> {
    return this.client.request('/channels', { params: { filter_by_prefix: options?.filter_by_prefix, info: options?.info } });
  }

  async getChannel(channelName: string, options?: { info?: string }): Promise<PusherChannelInfo> {
    return this.client.request<PusherChannelInfo>(`/channels/${channelName}`, { params: { info: options?.info } });
  }

  async getChannelUsers(channelName: string): Promise<{ users: PusherUser[] }> {
    return this.client.request(`/channels/${channelName}/users`);
  }

  getClient(): PusherClient { return this.client; }
}
