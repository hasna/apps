import type { VoiceflowClient } from './client';
import type { VoiceflowEventListResponse } from '../types';

export class EventsApi {
  constructor(private readonly client: VoiceflowClient) {}

  async list(params?: Record<string, string | number | boolean | undefined>): Promise<VoiceflowEventListResponse> {
    return this.client.get<VoiceflowEventListResponse>('/events', params);
  }
}
