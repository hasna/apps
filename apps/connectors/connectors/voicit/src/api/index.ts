// Voicit Connector — AI meeting transcription and note-taking
import { VoicitClient } from './client';
import type { VoicitConfig, VCMeeting, VCMeetingList, VCTranscript, VCSummary } from '../types';
export { VoicitClient } from './client';

export class Voicit {
  private readonly client: VoicitClient;
  constructor(config: VoicitConfig) { this.client = new VoicitClient(config); }
  static fromEnv(): Voicit {
    const apiKey = process.env.VOICIT_API_KEY;
    if (!apiKey) throw new Error('VOICIT_API_KEY is required');
    return new Voicit({ apiKey });
  }

  async listMeetings(options?: { page?: number; per_page?: number }): Promise<VCMeetingList> {
    return this.client.request<VCMeetingList>('/meetings', { params: { page: options?.page, per_page: options?.per_page } });
  }
  async getMeeting(meetingId: string): Promise<VCMeeting> { return this.client.request<VCMeeting>(`/meetings/${meetingId}`); }
  async deleteMeeting(meetingId: string): Promise<void> { await this.client.request(`/meetings/${meetingId}`, { method: 'DELETE' }); }

  async getTranscript(meetingId: string): Promise<VCTranscript> { return this.client.request<VCTranscript>(`/meetings/${meetingId}/transcript`); }
  async getSummary(meetingId: string): Promise<VCSummary> { return this.client.request<VCSummary>(`/meetings/${meetingId}/summary`); }

  getClient(): VoicitClient { return this.client; }
}
