// Cisco Umbrella Connector — Cloud security and DNS protection
import { CiscoUmbrellaClient } from './client';
import type { CiscoUmbrellaConfig, CUDestinationList, CUDestination, CUReport, CUCategory, CUSecurityEvent } from '../types';
export { CiscoUmbrellaClient } from './client';

export class CiscoUmbrella {
  private readonly client: CiscoUmbrellaClient;
  constructor(config: CiscoUmbrellaConfig) { this.client = new CiscoUmbrellaClient(config); }
  static fromEnv(): CiscoUmbrella {
    const apiKey = process.env.UMBRELLA_API_KEY;
    const apiSecret = process.env.UMBRELLA_API_SECRET;
    const orgId = process.env.UMBRELLA_ORG_ID;
    if (!apiKey || !apiSecret || !orgId) throw new Error('UMBRELLA_API_KEY, UMBRELLA_API_SECRET, and UMBRELLA_ORG_ID are required');
    return new CiscoUmbrella({ apiKey, apiSecret, orgId });
  }

  async listDestinationLists(): Promise<{ data: CUDestinationList[] }> {
    return this.client.request(`/policies/v2/destinationlists`);
  }
  async getDestinationList(listId: number): Promise<{ data: CUDestinationList }> {
    return this.client.request(`/policies/v2/destinationlists/${listId}`);
  }
  async addDestination(listId: number, destination: string, comment?: string): Promise<void> {
    await this.client.request(`/policies/v2/destinationlists/${listId}/destinations`, { method: 'POST', body: [{ destination, comment }] as unknown as Record<string, unknown> });
  }
  async removeDestination(listId: number, destinationId: number): Promise<void> {
    await this.client.request(`/policies/v2/destinationlists/${listId}/destinations/remove`, { method: 'DELETE', body: [destinationId] as unknown as Record<string, unknown> });
  }

  async getTopDomains(options?: { from?: string; to?: string; limit?: number }): Promise<{ data: CUReport[] }> {
    return this.client.request(`/reports/v2/organizations/${this.client.getOrgId()}/top-domains`, { params: { from: options?.from, to: options?.to, limit: options?.limit } });
  }

  async listCategories(): Promise<{ data: CUCategory[] }> { return this.client.request('/policies/v2/categories'); }

  async listSecurityEvents(options?: { from?: string; to?: string; limit?: number }): Promise<{ data: CUSecurityEvent[] }> {
    return this.client.request(`/reports/v2/organizations/${this.client.getOrgId()}/security-activity`, { params: { from: options?.from, to: options?.to, limit: options?.limit } });
  }

  getClient(): CiscoUmbrellaClient { return this.client; }
}
