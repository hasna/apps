import type { VoiceflowClient } from './client';
import type { VoiceflowSearchParams, VoiceflowSearchResponse } from '../types';

export class SearchApi {
  constructor(private readonly client: VoiceflowClient) {}

  async search(params: VoiceflowSearchParams): Promise<VoiceflowSearchResponse> {
    return this.client.post<VoiceflowSearchResponse>('/search', params);
  }
}
