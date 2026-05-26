// AlienVault OTX Connector — Open Threat Exchange threat intelligence
import { AlienVaultClient } from './client';
import type { AlienVaultConfig, OTXPulse, OTXPulseList, OTXIPReputation, OTXDomainInfo, OTXFileAnalysis } from '../types';
export { AlienVaultClient } from './client';

export class AlienVault {
  private readonly client: AlienVaultClient;
  constructor(config: AlienVaultConfig) { this.client = new AlienVaultClient(config); }
  static fromEnv(): AlienVault {
    const apiKey = process.env.ALIENVAULT_API_KEY;
    if (!apiKey) throw new Error('ALIENVAULT_API_KEY is required');
    return new AlienVault({ apiKey });
  }

  // Pulses (threat reports)
  async listSubscribedPulses(options?: { page?: number; limit?: number }): Promise<OTXPulseList> {
    return this.client.request<OTXPulseList>('/pulses/subscribed', { params: { page: options?.page, limit: options?.limit } });
  }
  async getPulse(pulseId: string): Promise<OTXPulse> { return this.client.request<OTXPulse>(`/pulses/${pulseId}`); }
  async getPulseIndicators(pulseId: string): Promise<{ results: unknown[] }> { return this.client.request(`/pulses/${pulseId}/indicators`); }
  async searchPulses(query: string, options?: { page?: number }): Promise<OTXPulseList> {
    return this.client.request<OTXPulseList>('/search/pulses', { params: { q: query, page: options?.page } });
  }

  // IP reputation
  async getIPv4General(ip: string): Promise<OTXIPReputation> { return this.client.request<OTXIPReputation>(`/indicators/IPv4/${ip}/general`); }
  async getIPv4Reputation(ip: string): Promise<OTXIPReputation> { return this.client.request<OTXIPReputation>(`/indicators/IPv4/${ip}/reputation`); }
  async getIPv6General(ip: string): Promise<OTXIPReputation> { return this.client.request<OTXIPReputation>(`/indicators/IPv6/${ip}/general`); }

  // Domain analysis
  async getDomainGeneral(domain: string): Promise<OTXDomainInfo> { return this.client.request<OTXDomainInfo>(`/indicators/domain/${domain}/general`); }
  async getHostnameGeneral(hostname: string): Promise<OTXDomainInfo> { return this.client.request<OTXDomainInfo>(`/indicators/hostname/${hostname}/general`); }

  // File hash analysis
  async getFileAnalysis(hash: string): Promise<OTXFileAnalysis> { return this.client.request<OTXFileAnalysis>(`/indicators/file/${hash}/general`); }

  // URL analysis
  async getURLGeneral(url: string): Promise<Record<string, unknown>> { return this.client.request(`/indicators/url/${encodeURIComponent(url)}/general`); }

  getClient(): AlienVaultClient { return this.client; }
}
