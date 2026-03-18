// Dropcontact Connector — B2B contact enrichment and email finder
import { DropcontactClient } from './client';
import type { DropcontactConfig, EnrichContactInput, EnrichResult, CreditInfo } from '../types';
export { DropcontactClient } from './client';
export class Dropcontact {
  private readonly client: DropcontactClient;
  constructor(config: DropcontactConfig) { this.client = new DropcontactClient(config); }
  static fromEnv(): Dropcontact {
    const apiKey = process.env.DROPCONTACT_API_KEY;
    if (!apiKey) throw new Error('DROPCONTACT_API_KEY environment variable is required');
    return new Dropcontact({ apiKey });
  }
  /** Submit contacts for enrichment. Returns request_id for polling. */
  async enrich(contacts: EnrichContactInput[], options?: { siren?: boolean; language?: string }): Promise<{ request_id: string; error?: boolean; reason?: string; credits_used?: number }> {
    return this.client.request('/batch/enrich', {
      method: 'POST',
      body: { data: contacts, siren: options?.siren ?? false, language: options?.language ?? 'en' },
    });
  }
  /** Get enrichment results (may be pending — check error field). */
  async getEnrichment(requestId: string): Promise<EnrichResult> {
    return this.client.request<EnrichResult>(`/batch/${requestId}`);
  }
  /** Enrich a single contact synchronously (polls until done or timeout). */
  async enrichOne(contact: EnrichContactInput, maxWaitMs = 30000): Promise<EnrichResult> {
    const { request_id } = await this.enrich([contact]);
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const result = await this.getEnrichment(request_id);
      if (!result.error) return result;
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error(`Enrichment ${request_id} timed out after ${maxWaitMs}ms`);
  }
  /** Check remaining credits. */
  async getCredits(): Promise<CreditInfo> {
    return this.client.request<CreditInfo>('/credits');
  }
  getClient(): DropcontactClient { return this.client; }
}
