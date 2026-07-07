import type { ZohoCliqClient } from './client';
import type { ZohoCliqChannel, ZohoCliqChannelType } from '../types';

export class ChannelsApi {
  constructor(private readonly client: ZohoCliqClient) {}

  async list(options?: {
    limit?: number;
    offset?: number;
    type?: ZohoCliqChannelType;
  }): Promise<unknown> {
    return this.client.get('/channels', {
      limit: options?.limit,
      offset: options?.offset,
      type: options?.type,
    });
  }

  async get(id: string): Promise<ZohoCliqChannel> {
    return this.client.get<ZohoCliqChannel>(`/channels/${encodeURIComponent(id)}`);
  }

  async create(options: {
    name: string;
    description?: string;
    type?: ZohoCliqChannelType;
    userIds?: string[];
    emails?: string[];
  }): Promise<unknown> {
    return this.client.post('/channels', {
      name: options.name,
      description: options.description,
      type: options.type,
      user_ids: options.userIds,
      emails: options.emails,
    });
  }

  async update(id: string, options: { name?: string; description?: string }): Promise<unknown> {
    return this.client.put(`/channels/${encodeURIComponent(id)}`, {
      name: options.name,
      description: options.description,
    });
  }

  async delete(id: string): Promise<unknown> {
    return this.client.delete(`/channels/${encodeURIComponent(id)}`);
  }

  async join(id: string): Promise<unknown> {
    return this.client.post(`/channels/${encodeURIComponent(id)}/join`);
  }

  async leave(id: string): Promise<unknown> {
    return this.client.post(`/channels/${encodeURIComponent(id)}/leave`);
  }

  async listMembers(
    id: string,
    options?: { limit?: number; offset?: number }
  ): Promise<unknown> {
    return this.client.get(`/channels/${encodeURIComponent(id)}/members`, {
      limit: options?.limit,
      offset: options?.offset,
    });
  }

  async addMembers(
    id: string,
    options: { userIds?: string[]; emails?: string[] }
  ): Promise<unknown> {
    return this.client.post(`/channels/${encodeURIComponent(id)}/members`, {
      user_ids: options.userIds,
      emails: options.emails,
    });
  }

  async removeMember(channelId: string, userId: string): Promise<unknown> {
    return this.client.delete(
      `/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(userId)}`
    );
  }
}
