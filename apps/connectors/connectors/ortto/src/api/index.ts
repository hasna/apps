// Ortto Connector — Customer data platform and marketing automation
import { OrttoClient } from './client';
import type { OrttoConfig, OTPerson, OTPersonList, OTActivity, OTJourney, OTAudience, OTTag } from '../types';
export { OrttoClient } from './client';

export class Ortto {
  private readonly client: OrttoClient;
  constructor(config: OrttoConfig) { this.client = new OrttoClient(config); }
  static fromEnv(): Ortto {
    const apiKey = process.env.ORTTO_API_KEY;
    if (!apiKey) throw new Error('ORTTO_API_KEY is required');
    return new Ortto({ apiKey, region: process.env.ORTTO_REGION });
  }

  async getPersons(options?: { fields?: string[]; limit?: number; cursor?: string; filter?: Record<string, unknown> }): Promise<OTPersonList> {
    return this.client.request<OTPersonList>('/person/get', { body: { fields: options?.fields, limit: options?.limit, cursor: options?.cursor, filter: options?.filter } as Record<string, unknown> });
  }
  async mergePerson(fields: Record<string, unknown>, tags?: string[]): Promise<OTPerson> {
    return this.client.request<OTPerson>('/person/merge', { body: { people: [{ fields, tags }] } as Record<string, unknown> });
  }
  async deletePerson(personId: string): Promise<void> {
    await this.client.request('/person/delete', { body: { people: [{ person_id: personId }] } as Record<string, unknown> });
  }

  async trackActivity(personId: string, activityName: string, attributes?: Record<string, unknown>): Promise<void> {
    await this.client.request('/activities/create', { body: { activities: [{ person_id: personId, activity_id: activityName, attributes }] } as Record<string, unknown> });
  }

  async listJourneys(): Promise<{ journeys: OTJourney[] }> { return this.client.request('/journeys/get', { body: {} }); }
  async listAudiences(): Promise<{ audiences: OTAudience[] }> { return this.client.request('/audiences/get', { body: {} }); }
  async listTags(): Promise<{ tags: OTTag[] }> { return this.client.request('/tags/get', { body: {} }); }
  async createTag(tag: string): Promise<void> { await this.client.request('/tags/create', { body: { tag } }); }

  getClient(): OrttoClient { return this.client; }
}
