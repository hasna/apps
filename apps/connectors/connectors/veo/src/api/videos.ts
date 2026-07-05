import type { VeoClient } from './client';
import { encodePathSegment } from './client';
import type { VeoTranscript, VeoVideo } from '../types';

export class VideosApi {
  constructor(private readonly client: VeoClient) {}

  async list(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get<unknown>('/videos/v3/get-all', params);
  }

  async get(videoId: string, params?: Record<string, string | number | boolean | undefined>): Promise<VeoVideo> {
    return this.client.get<VeoVideo>(`/videos/${encodePathSegment(videoId)}`, params);
  }

  async getTranscript(
    videoId: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<VeoTranscript> {
    return this.client.get<VeoTranscript>(`/videos/${encodePathSegment(videoId)}/transcript`, params);
  }
}
