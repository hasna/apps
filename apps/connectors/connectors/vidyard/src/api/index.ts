import type {
  VidyardConfig,
  VidyardEvent,
  VidyardRequestOptions,
  VidyardSearchParams,
  VidyardVideo,
} from '../types';
import { VidyardClient } from './client';

export { VidyardClient, DEFAULT_BASE_URL } from './client';

export class Vidyard {
  private readonly client: VidyardClient;

  constructor(config: VidyardConfig) {
    this.client = new VidyardClient(config);
  }

  static fromEnv(): Vidyard {
    const apiKey = process.env.VIDYARD_API_KEY;
    if (!apiKey) {
      throw new Error('VIDYARD_API_KEY environment variable is required');
    }

    return new Vidyard({
      apiKey,
      baseUrl: process.env.VIDYARD_BASE_URL,
    });
  }

  async listVideos(params?: Record<string, string | number | boolean | undefined>): Promise<VidyardVideo[]> {
    const result = await this.client.get<VidyardVideo[] | { videos?: VidyardVideo[] }>('/videos', params);
    if (Array.isArray(result)) {
      return result;
    }
    return result.videos ?? [];
  }

  async getVideo(id: number | string): Promise<VidyardVideo> {
    return this.client.get<VidyardVideo>(`/videos/${id}`);
  }

  async createVideo(video: Record<string, unknown>): Promise<VidyardVideo> {
    return this.client.post<VidyardVideo>('/videos', { video });
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<VidyardEvent[]> {
    const result = await this.client.get<VidyardEvent[] | { events?: VidyardEvent[] }>('/events', params);
    if (Array.isArray(result)) {
      return result;
    }
    return result.events ?? [];
  }

  async getEvent(id: number | string): Promise<VidyardEvent> {
    return this.client.get<VidyardEvent>(`/events/${id}`);
  }

  async searchEvents(params: VidyardSearchParams = {}): Promise<unknown> {
    return this.client.get('/events/search', params);
  }

  async searchPlayers(params: VidyardSearchParams = {}): Promise<unknown> {
    return this.client.get('/players/search', params);
  }

  async getDashboard(): Promise<{ playback_domain?: string; embed_domain?: string }> {
    return this.client.get('/');
  }

  async rawRequest<T = unknown>(path: string, options: VidyardRequestOptions = {}): Promise<T> {
    return this.client.request<T>(path, options);
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): VidyardClient {
    return this.client;
  }
}
