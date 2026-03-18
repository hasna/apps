// Nyota Connector — AI meeting notes and action item tracking
import { NyotaClient } from './client';
import type { NyotaConfig, NYMeeting, NYMeetingList, NYTranscript, NYSummary, NYActionItem } from '../types';
export { NyotaClient } from './client';

export class Nyota {
  private readonly client: NyotaClient;
  constructor(config: NyotaConfig) { this.client = new NyotaClient(config); }
  static fromEnv(): Nyota {
    const apiKey = process.env.NYOTA_API_KEY;
    if (!apiKey) throw new Error('NYOTA_API_KEY is required');
    return new Nyota({ apiKey });
  }

  async listMeetings(options?: { page?: number; per_page?: number; status?: string }): Promise<NYMeetingList> {
    return this.client.request<NYMeetingList>('/meetings', { params: { page: options?.page, per_page: options?.per_page, status: options?.status } });
  }
  async getMeeting(meetingId: string): Promise<NYMeeting> { return this.client.request<NYMeeting>(`/meetings/${meetingId}`); }
  async deleteMeeting(meetingId: string): Promise<void> { await this.client.request(`/meetings/${meetingId}`, { method: 'DELETE' }); }

  async getTranscript(meetingId: string): Promise<NYTranscript> { return this.client.request<NYTranscript>(`/meetings/${meetingId}/transcript`); }
  async getSummary(meetingId: string): Promise<NYSummary> { return this.client.request<NYSummary>(`/meetings/${meetingId}/summary`); }

  async listActionItems(options?: { meeting_id?: string; status?: string }): Promise<NYActionItem[]> {
    return this.client.request<NYActionItem[]>('/action-items', { params: { meeting_id: options?.meeting_id, status: options?.status } });
  }
  async updateActionItem(actionItemId: string, data: { status?: string; assignee?: string; due_date?: string }): Promise<NYActionItem> {
    return this.client.request<NYActionItem>(`/action-items/${actionItemId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }

  getClient(): NyotaClient { return this.client; }
}
