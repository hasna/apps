// Mattermost Connector — Open-source team messaging and collaboration
import { MattermostClient } from './client';
import type { MattermostConfig, MMUser, MMTeam, MMChannel, MMPost, MMPostList } from '../types';
export { MattermostClient } from './client';

export class Mattermost {
  private readonly client: MattermostClient;
  constructor(config: MattermostConfig) { this.client = new MattermostClient(config); }
  static fromEnv(): Mattermost {
    const url = process.env.MATTERMOST_URL;
    const token = process.env.MATTERMOST_TOKEN;
    if (!url || !token) throw new Error('MATTERMOST_URL and MATTERMOST_TOKEN are required');
    return new Mattermost({ url, token });
  }

  async getMe(): Promise<MMUser> { return this.client.request<MMUser>('/users/me'); }
  async getUser(userId: string): Promise<MMUser> { return this.client.request<MMUser>(`/users/${userId}`); }
  async getUserByUsername(username: string): Promise<MMUser> { return this.client.request<MMUser>(`/users/username/${username}`); }
  async searchUsers(term: string): Promise<MMUser[]> { return this.client.request<MMUser[]>('/users/search', { method: 'POST', body: { term } }); }

  async listTeams(): Promise<MMTeam[]> { return this.client.request<MMTeam[]>('/teams'); }
  async getTeam(teamId: string): Promise<MMTeam> { return this.client.request<MMTeam>(`/teams/${teamId}`); }

  async listChannelsForTeam(teamId: string): Promise<MMChannel[]> { return this.client.request<MMChannel[]>(`/teams/${teamId}/channels`); }
  async getChannel(channelId: string): Promise<MMChannel> { return this.client.request<MMChannel>(`/channels/${channelId}`); }
  async createChannel(data: { team_id: string; name: string; display_name: string; type: 'O' | 'P'; purpose?: string; header?: string }): Promise<MMChannel> {
    return this.client.request<MMChannel>('/channels', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteChannel(channelId: string): Promise<void> { await this.client.request(`/channels/${channelId}`, { method: 'DELETE' }); }

  async getPostsForChannel(channelId: string, options?: { page?: number; perPage?: number }): Promise<MMPostList> {
    return this.client.request<MMPostList>(`/channels/${channelId}/posts`, { params: { page: options?.page, per_page: options?.perPage } });
  }
  async createPost(data: { channel_id: string; message: string; root_id?: string }): Promise<MMPost> {
    return this.client.request<MMPost>('/posts', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deletePost(postId: string): Promise<void> { await this.client.request(`/posts/${postId}`, { method: 'DELETE' }); }
  async searchPosts(teamId: string, terms: string): Promise<MMPostList> {
    return this.client.request<MMPostList>(`/teams/${teamId}/posts/search`, { method: 'POST', body: { terms } });
  }

  getClient(): MattermostClient { return this.client; }
}
