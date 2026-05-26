// Supernormal Connector — AI meeting notes and transcription
import { SupernormalClient } from './client';
import type { SupernormalConfig, SNMeeting, SNMeetingList, SNTranscript, SNSummary, SNNote } from '../types';
export { SupernormalClient } from './client';

export class Supernormal {
  private readonly client: SupernormalClient;
  constructor(config: SupernormalConfig) { this.client = new SupernormalClient(config); }
  static fromEnv(): Supernormal {
    const apiKey = process.env.SUPERNORMAL_API_KEY;
    if (!apiKey) throw new Error('SUPERNORMAL_API_KEY is required');
    return new Supernormal({ apiKey });
  }

  async listMeetings(options?: { page?: number; per_page?: number; status?: string }): Promise<SNMeetingList> {
    return this.client.request<SNMeetingList>('/meetings', { params: { page: options?.page, per_page: options?.per_page, status: options?.status } });
  }
  async getMeeting(meetingId: string): Promise<SNMeeting> { return this.client.request<SNMeeting>(`/meetings/${meetingId}`); }
  async deleteMeeting(meetingId: string): Promise<void> { await this.client.request(`/meetings/${meetingId}`, { method: 'DELETE' }); }

  async getTranscript(meetingId: string): Promise<SNTranscript> { return this.client.request<SNTranscript>(`/meetings/${meetingId}/transcript`); }
  async getSummary(meetingId: string): Promise<SNSummary> { return this.client.request<SNSummary>(`/meetings/${meetingId}/summary`); }

  async listNotes(meetingId: string): Promise<SNNote[]> { return this.client.request<SNNote[]>(`/meetings/${meetingId}/notes`); }
  async createNote(meetingId: string, content: string): Promise<SNNote> {
    return this.client.request<SNNote>(`/meetings/${meetingId}/notes`, { method: 'POST', body: { content } });
  }
  async updateNote(meetingId: string, noteId: string, content: string): Promise<SNNote> {
    return this.client.request<SNNote>(`/meetings/${meetingId}/notes/${noteId}`, { method: 'PUT', body: { content } });
  }
  async deleteNote(meetingId: string, noteId: string): Promise<void> {
    await this.client.request(`/meetings/${meetingId}/notes/${noteId}`, { method: 'DELETE' });
  }

  getClient(): SupernormalClient { return this.client; }
}
