// Grain Connector — Meeting recording and highlights
import { GrainClient } from './client';
import type { GrainConfig, GrainRecording, GrainHighlight, GrainStory } from '../types';
export { GrainClient } from './client';

export class Grain {
  private readonly client: GrainClient;
  constructor(config: GrainConfig) { this.client = new GrainClient(config); }
  static fromEnv(): Grain {
    const apiKey = process.env.GRAIN_API_KEY;
    if (!apiKey) throw new Error('GRAIN_API_KEY environment variable is required');
    return new Grain({ apiKey });
  }
  async listRecordings(options?: { limit?: number; page?: number }): Promise<GrainRecording[]> {
    const r = await this.client.request<{ recordings: GrainRecording[] }>('/recordings', { params: options as Record<string, number | undefined> });
    return r.recordings ?? [];
  }
  async getRecording(id: string): Promise<GrainRecording> { return this.client.request<GrainRecording>(`/recordings/${id}`); }
  async getTranscript(recordingId: string): Promise<string> {
    const r = await this.client.request<{ transcript: string }>(`/recordings/${recordingId}/transcript`);
    return r.transcript;
  }
  async listHighlights(options?: { recordingId?: string; limit?: number }): Promise<GrainHighlight[]> {
    const r = await this.client.request<{ highlights: GrainHighlight[] }>('/highlights', {
      params: { recording_id: options?.recordingId, limit: options?.limit },
    });
    return r.highlights ?? [];
  }
  async getHighlight(id: string): Promise<GrainHighlight> { return this.client.request<GrainHighlight>(`/highlights/${id}`); }
  async listStories(options?: { limit?: number }): Promise<GrainStory[]> {
    const r = await this.client.request<{ stories: GrainStory[] }>('/stories', { params: options as Record<string, number | undefined> });
    return r.stories ?? [];
  }
  async getStory(id: string): Promise<GrainStory> { return this.client.request<GrainStory>(`/stories/${id}`); }
  getClient(): GrainClient { return this.client; }
}
