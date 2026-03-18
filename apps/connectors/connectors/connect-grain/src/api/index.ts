// Grain Connector — Meeting recording and highlights
import { GrainClient } from './client';
import type { GrainConfig, GrainRecording, GrainRecordingList, GrainHighlight, GrainHighlightList, GrainCollection } from '../types';
export { GrainClient } from './client';

export class Grain {
  private readonly client: GrainClient;
  constructor(config: GrainConfig) { this.client = new GrainClient(config); }
  static fromEnv(): Grain {
    const token = process.env.GRAIN_TOKEN;
    if (!token) throw new Error('GRAIN_TOKEN is required');
    return new Grain({ token });
  }

  async listRecordings(options?: { page?: number; per_page?: number }): Promise<GrainRecordingList> {
    return this.client.request<GrainRecordingList>('/recordings', { params: { page: options?.page, per_page: options?.per_page } });
  }
  async getRecording(recordingId: string): Promise<GrainRecording> { return this.client.request<GrainRecording>(`/recordings/${recordingId}`); }
  async deleteRecording(recordingId: string): Promise<void> { await this.client.request(`/recordings/${recordingId}`, { method: 'DELETE' }); }

  async listHighlights(recordingId: string): Promise<GrainHighlightList> {
    return this.client.request<GrainHighlightList>(`/recordings/${recordingId}/highlights`);
  }
  async getHighlight(highlightId: string): Promise<GrainHighlight> { return this.client.request<GrainHighlight>(`/highlights/${highlightId}`); }
  async createHighlight(recordingId: string, data: { title: string; start_time: number; end_time: number; tags?: string[] }): Promise<GrainHighlight> {
    return this.client.request<GrainHighlight>(`/recordings/${recordingId}/highlights`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteHighlight(highlightId: string): Promise<void> { await this.client.request(`/highlights/${highlightId}`, { method: 'DELETE' }); }

  async listCollections(): Promise<GrainCollection[]> { return this.client.request<GrainCollection[]>('/collections'); }
  async getCollection(collectionId: string): Promise<GrainCollection> { return this.client.request<GrainCollection>(`/collections/${collectionId}`); }
  async addHighlightToCollection(collectionId: string, highlightId: string): Promise<void> {
    await this.client.request(`/collections/${collectionId}/highlights`, { method: 'POST', body: { highlight_id: highlightId } });
  }

  getClient(): GrainClient { return this.client; }
}
