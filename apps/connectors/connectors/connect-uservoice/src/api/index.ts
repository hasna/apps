// UserVoice Connector — Product feedback and customer insights
import { UserVoiceClient } from './client';
import type { UserVoiceConfig, UVSuggestion, UVUser, UVForum, UVTicket } from '../types';
export { UserVoiceClient } from './client';
export class UserVoice {
  private readonly client: UserVoiceClient;
  constructor(config: UserVoiceConfig) { this.client = new UserVoiceClient(config); }
  static fromEnv(): UserVoice {
    const apiKey = process.env.USERVOICE_API_KEY;
    const subdomain = process.env.USERVOICE_SUBDOMAIN;
    if (!apiKey || !subdomain) throw new Error('USERVOICE_API_KEY and USERVOICE_SUBDOMAIN are required');
    return new UserVoice({ apiKey, subdomain });
  }
  async listForums(): Promise<UVForum[]> { const r = await this.client.request<{ forums: UVForum[] }>('/forums'); return r.forums ?? []; }
  async listSuggestions(forumId?: number, options?: { sort?: string; page?: number; perPage?: number; status?: string }): Promise<UVSuggestion[]> {
    const path = forumId ? `/forums/${forumId}/suggestions` : '/suggestions';
    const r = await this.client.request<{ suggestions: UVSuggestion[] }>(path, { params: { sort: options?.sort, page: options?.page, per_page: options?.perPage, status: options?.status } });
    return r.suggestions ?? [];
  }
  async getSuggestion(suggestionId: number): Promise<UVSuggestion> { return (await this.client.request<{ suggestion: UVSuggestion }>(`/suggestions/${suggestionId}`)).suggestion; }
  async createSuggestion(forumId: number, title: string, body?: string): Promise<UVSuggestion> {
    const r = await this.client.request<{ suggestion: UVSuggestion }>(`/forums/${forumId}/suggestions`, { method: 'POST', body: { suggestion: { title, body } } });
    return r.suggestion;
  }
  async updateSuggestionStatus(suggestionId: number, status: string): Promise<UVSuggestion> {
    const r = await this.client.request<{ suggestion: UVSuggestion }>(`/suggestions/${suggestionId}`, { method: 'PUT', body: { suggestion: { status } } });
    return r.suggestion;
  }
  async listUsers(options?: { page?: number; perPage?: number }): Promise<UVUser[]> { const r = await this.client.request<{ users: UVUser[] }>('/users', { params: options as Record<string, number | undefined> }); return r.users ?? []; }
  async getUser(userId: number): Promise<UVUser> { return (await this.client.request<{ user: UVUser }>(`/users/${userId}`)).user; }
  async listTickets(options?: { page?: number; perPage?: number; state?: string }): Promise<UVTicket[]> { const r = await this.client.request<{ tickets: UVTicket[] }>('/tickets', { params: options as Record<string, string | number | undefined> }); return r.tickets ?? []; }
  getClient(): UserVoiceClient { return this.client; }
}
