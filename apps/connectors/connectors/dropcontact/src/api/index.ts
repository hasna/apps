// Dropcontact Connector — B2B contact enrichment and email finder
import { DropcontactClient } from './client';
import type { DropcontactConfig, DCContact, DCEnrichResult, DCEnrichStatus } from '../types';
export { DropcontactClient } from './client';

export class Dropcontact {
  private readonly client: DropcontactClient;
  constructor(config: DropcontactConfig) { this.client = new DropcontactClient(config); }
  static fromEnv(): Dropcontact {
    const apiKey = process.env.DROPCONTACT_API_KEY;
    if (!apiKey) throw new Error('DROPCONTACT_API_KEY is required');
    return new Dropcontact({ apiKey });
  }

  async enrich(contacts: DCContact[], options?: { siren?: boolean; language?: string }): Promise<DCEnrichResult> {
    return this.client.request<DCEnrichResult>('/batch', { method: 'POST', body: { data: contacts, siren: options?.siren, language: options?.language } as Record<string, unknown> });
  }

  async getEnrichStatus(requestId: string): Promise<DCEnrichStatus> {
    return this.client.request<DCEnrichStatus>(`/batch/${requestId}`);
  }

  async findEmail(firstName: string, lastName: string, company: string): Promise<DCEnrichResult> {
    return this.client.request<DCEnrichResult>('/batch', { method: 'POST', body: { data: [{ first_name: firstName, last_name: lastName, company }] } as Record<string, unknown> });
  }

  async verifyEmail(email: string): Promise<DCEnrichResult> {
    return this.client.request<DCEnrichResult>('/batch', { method: 'POST', body: { data: [{ email }] } as Record<string, unknown> });
  }

  getClient(): DropcontactClient { return this.client; }
}
