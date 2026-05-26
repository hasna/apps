// Mist Connector — Juniper Mist AI-driven wireless network management
import { MistClient } from './client';
import type { MistConfig, MistSite, MistAP, MistClient as MistClientType, MistWlan, MistOrg } from '../types';
export { MistClient } from './client';

export class Mist {
  private readonly client: MistClient;
  constructor(config: MistConfig) { this.client = new MistClient(config); }
  static fromEnv(): Mist {
    const token = process.env.MIST_TOKEN;
    if (!token) throw new Error('MIST_TOKEN is required');
    return new Mist({ token, baseUrl: process.env.MIST_BASE_URL });
  }

  async listOrgs(): Promise<MistOrg[]> { return this.client.request<MistOrg[]>('/self/orgs'); }

  async listSites(orgId: string): Promise<MistSite[]> { return this.client.request<MistSite[]>(`/orgs/${orgId}/sites`); }
  async getSite(siteId: string): Promise<MistSite> { return this.client.request<MistSite>(`/sites/${siteId}`); }

  async listAPs(siteId: string): Promise<MistAP[]> { return this.client.request<MistAP[]>(`/sites/${siteId}/devices`); }
  async getAP(siteId: string, deviceId: string): Promise<MistAP> { return this.client.request<MistAP>(`/sites/${siteId}/devices/${deviceId}`); }

  async listClients(siteId: string): Promise<MistClientType[]> { return this.client.request<MistClientType[]>(`/sites/${siteId}/stats/clients`); }

  async listWlans(siteId: string): Promise<MistWlan[]> { return this.client.request<MistWlan[]>(`/sites/${siteId}/wlans`); }
  async getWlan(siteId: string, wlanId: string): Promise<MistWlan> { return this.client.request<MistWlan>(`/sites/${siteId}/wlans/${wlanId}`); }
  async createWlan(siteId: string, data: { ssid: string; auth?: { type: string; psk?: string }; enabled?: boolean }): Promise<MistWlan> {
    return this.client.request<MistWlan>(`/sites/${siteId}/wlans`, { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): MistClient { return this.client; }
}
