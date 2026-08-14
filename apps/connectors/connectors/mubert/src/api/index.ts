import type { MubertConfig, TrackRequest, Track, TracksListResponse } from '../types';
import { MubertClient } from './client';

export class Mubert {
  private readonly client: MubertClient;

  constructor(config: MubertConfig) {
    this.client = new MubertClient(config);
  }

  async createTrack(params: TrackRequest): Promise<Track> {
    return this.client.createTrack(params);
  }

  async getTrack(trackId: string): Promise<Track> {
    return this.client.getTrack(trackId);
  }

  async listTracks(limit?: number, offset?: number): Promise<TracksListResponse> {
    return this.client.listTracks(limit, offset);
  }

  async deleteTrack(trackId: string): Promise<void> {
    return this.client.deleteTrack(trackId);
  }

  static fromEnv(): Mubert {
    const apiKey = process.env.MUBERT_API_KEY;
    if (!apiKey) {
      throw new Error('MUBERT_API_KEY environment variable is required');
    }
    return new Mubert({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { MubertClient } from './client';
