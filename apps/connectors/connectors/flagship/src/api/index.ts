// Flagship Connector — Feature flagging and experimentation platform
import { FlagshipClient } from './client';
import type { FlagshipConfig, FSFlag, FSCampaign, FSVisitor } from '../types';
export { FlagshipClient } from './client';

export class Flagship {
  private readonly client: FlagshipClient;
  constructor(config: FlagshipConfig) { this.client = new FlagshipClient(config); }
  static fromEnv(): Flagship {
    const apiKey = process.env.FLAGSHIP_API_KEY;
    const environmentId = process.env.FLAGSHIP_ENV_ID;
    if (!apiKey || !environmentId) throw new Error('FLAGSHIP_API_KEY and FLAGSHIP_ENV_ID are required');
    return new Flagship({ apiKey, environmentId });
  }

  async getFlags(visitorId: string, context?: Record<string, unknown>): Promise<{ campaigns: FSCampaign[]; flags: Record<string, FSFlag> }> {
    return this.client.request('/campaigns', { method: 'POST', body: { visitor_id: visitorId, context: context || {}, trigger_hit: false } as Record<string, unknown> });
  }

  async activateFlag(visitorId: string, campaignId: string, variationGroupId: string, variationId: string): Promise<void> {
    await this.client.request('/activate', { method: 'POST', body: { vid: visitorId, cid: campaignId, vgid: variationGroupId, caid: variationId } });
  }

  async sendEvent(visitorId: string, type: string, data: Record<string, unknown>): Promise<void> {
    await this.client.request('/events', { method: 'POST', body: { visitor_id: visitorId, type, data } });
  }

  async sendHit(visitorId: string, hit: { type: string; action?: string; category?: string; label?: string; value?: number }): Promise<void> {
    await this.client.request('/events', { method: 'POST', body: { visitor_id: visitorId, type: 'EVENT', data: hit } });
  }

  getClient(): FlagshipClient { return this.client; }
}
