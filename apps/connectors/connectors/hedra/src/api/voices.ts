import type { HedraClient } from './client';
import type { HedraVoice } from '../types';

/**
 * Voices API - Manage available voices for Hedra video generation
 */
export class VoicesApi {
  constructor(private readonly client: HedraClient) {}

  /**
   * List all available voices
   */
  async list(): Promise<HedraVoice[]> {
    return this.client.get<HedraVoice[]>('/v1/voices');
  }

  /**
   * Get a single voice by ID
   */
  async get(id: string): Promise<HedraVoice> {
    return this.client.get<HedraVoice>(`/v1/voices/${id}`);
  }
}
