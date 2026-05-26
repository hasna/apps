// Vowel Connector — Video meetings with transcription and summaries
import { VowelClient } from './client';
import type { VowelConfig, VWMeeting, VWMeetingList, VWTranscript, VWSummary, VWBookmark } from '../types';
export { VowelClient } from './client';

export class Vowel {
  private readonly client: VowelClient;
  constructor(config: VowelConfig) { this.client = new VowelClient(config); }
  static fromEnv(): Vowel {
    const apiKey = process.env.VOWEL_API_KEY;
    if (!apiKey) throw new Error('VOWEL_API_KEY is required');
    return new Vowel({ apiKey });
  }

  async listMeetings(options?: { page?: number; per_page?: number }): Promise<VWMeetingList> {
    return this.client.request<VWMeetingList>('/meetings', { params: { page: options?.page, per_page: options?.per_page } });
  }
  async getMeeting(meetingId: string): Promise<VWMeeting> { return this.client.request<VWMeeting>(`/meetings/${meetingId}`); }

  async getTranscript(meetingId: string): Promise<VWTranscript> { return this.client.request<VWTranscript>(`/meetings/${meetingId}/transcript`); }
  async getSummary(meetingId: string): Promise<VWSummary> { return this.client.request<VWSummary>(`/meetings/${meetingId}/summary`); }

  async listBookmarks(meetingId: string): Promise<VWBookmark[]> { return this.client.request<VWBookmark[]>(`/meetings/${meetingId}/bookmarks`); }
  async createBookmark(meetingId: string, data: { timestamp: number; note: string }): Promise<VWBookmark> {
    return this.client.request<VWBookmark>(`/meetings/${meetingId}/bookmarks`, { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): VowelClient { return this.client; }
}
