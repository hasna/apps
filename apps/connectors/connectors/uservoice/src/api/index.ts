// UserVoice Connector — Product feedback and customer insight platform
import { UserVoiceClient } from './client';
import type { UserVoiceConfig, UVSuggestion, UVSuggestionList, UVUser, UVUserList, UVForum, UVStatus, UVCategory, UVComment } from '../types';
export { UserVoiceClient } from './client';

export class UserVoice {
  private readonly client: UserVoiceClient;
  constructor(config: UserVoiceConfig) { this.client = new UserVoiceClient(config); }
  static fromEnv(): UserVoice {
    const token = process.env.USERVOICE_TOKEN;
    const subdomain = process.env.USERVOICE_SUBDOMAIN;
    if (!token || !subdomain) throw new Error('USERVOICE_TOKEN and USERVOICE_SUBDOMAIN are required');
    return new UserVoice({ token, subdomain });
  }

  async listSuggestions(options?: { page?: number; per_page?: number; state?: string; sort?: string; forum_id?: number }): Promise<UVSuggestionList> {
    return this.client.request<UVSuggestionList>('/admin/suggestions', { params: { page: options?.page, per_page: options?.per_page, state: options?.state, sort: options?.sort, forum_id: options?.forum_id } });
  }
  async getSuggestion(suggestionId: number): Promise<{ suggestion: UVSuggestion }> { return this.client.request(`/admin/suggestions/${suggestionId}`); }
  async updateSuggestionStatus(suggestionId: number, statusId: number): Promise<{ suggestion: UVSuggestion }> {
    return this.client.request(`/admin/suggestions/${suggestionId}/status`, { method: 'PUT', body: { status_id: statusId } });
  }

  async listComments(suggestionId: number): Promise<{ comments: UVComment[] }> { return this.client.request(`/admin/suggestions/${suggestionId}/comments`); }
  async createComment(suggestionId: number, body: string): Promise<{ comment: UVComment }> {
    return this.client.request(`/admin/suggestions/${suggestionId}/comments`, { method: 'POST', body: { comment: { body } } });
  }

  async listUsers(options?: { page?: number; per_page?: number }): Promise<UVUserList> {
    return this.client.request<UVUserList>('/admin/users', { params: { page: options?.page, per_page: options?.per_page } });
  }
  async getUser(userId: number): Promise<{ user: UVUser }> { return this.client.request(`/admin/users/${userId}`); }

  async listForums(): Promise<{ forums: UVForum[] }> { return this.client.request('/admin/forums'); }
  async listStatuses(): Promise<{ statuses: UVStatus[] }> { return this.client.request('/admin/statuses'); }
  async listCategories(forumId: number): Promise<{ categories: UVCategory[] }> { return this.client.request(`/admin/forums/${forumId}/categories`); }

  getClient(): UserVoiceClient { return this.client; }
}
