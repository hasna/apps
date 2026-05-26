import type { DiscordClient } from './client';
import type { GatewayInfo, GatewayBotInfo, VoiceRegion } from '../types';

export class GatewayApi {
  constructor(private readonly client: DiscordClient) {}

  /**
   * Get Gateway URL
   */
  async getGateway(): Promise<GatewayInfo> {
    return this.client.get<GatewayInfo>('/gateway');
  }

  /**
   * Get Gateway Bot info (includes shard info and session limits)
   */
  async getGatewayBot(): Promise<GatewayBotInfo> {
    return this.client.get<GatewayBotInfo>('/gateway/bot');
  }

  /**
   * Get Voice Regions
   */
  async getVoiceRegions(): Promise<VoiceRegion[]> {
    return this.client.get<VoiceRegion[]>('/voice/regions');
  }
}
