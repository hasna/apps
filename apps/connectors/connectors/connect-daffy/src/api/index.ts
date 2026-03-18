// Daffy Connector — Donor-advised fund and charitable giving
import { DaffyClient } from './client';
import type { DaffyConfig, DFDonation, DFDonationList, DFNonprofit, DFAccount, DFContribution } from '../types';
export { DaffyClient } from './client';

export class Daffy {
  private readonly client: DaffyClient;
  constructor(config: DaffyConfig) { this.client = new DaffyClient(config); }
  static fromEnv(): Daffy {
    const apiKey = process.env.DAFFY_API_KEY;
    if (!apiKey) throw new Error('DAFFY_API_KEY is required');
    return new Daffy({ apiKey });
  }

  async getAccount(): Promise<DFAccount> { return this.client.request<DFAccount>('/users/me'); }

  async listDonations(options?: { limit?: number; offset?: number }): Promise<DFDonationList> {
    return this.client.request<DFDonationList>('/donations', { params: { limit: options?.limit, offset: options?.offset } });
  }
  async createDonation(data: { ein: string; amount: number; note?: string }): Promise<DFDonation> {
    return this.client.request<DFDonation>('/donations', { method: 'POST', body: data as Record<string, unknown> });
  }

  async searchNonprofits(query: string, options?: { limit?: number }): Promise<{ nonprofits: DFNonprofit[] }> {
    return this.client.request('/nonprofits/search', { params: { query, limit: options?.limit } });
  }
  async getNonprofit(ein: string): Promise<DFNonprofit> { return this.client.request<DFNonprofit>(`/nonprofits/${ein}`); }

  async listContributions(options?: { limit?: number }): Promise<{ contributions: DFContribution[] }> {
    return this.client.request('/contributions', { params: { limit: options?.limit } });
  }

  getClient(): DaffyClient { return this.client; }
}
