// MXToolbox Connector — DNS, email, and network diagnostic tools
import { MXToolboxClient } from './client';
import type { MXToolboxConfig, MXLookupResult, MXMonitor, MXUsage } from '../types';
export { MXToolboxClient } from './client';

export class MXToolbox {
  private readonly client: MXToolboxClient;
  constructor(config: MXToolboxConfig) { this.client = new MXToolboxClient(config); }
  static fromEnv(): MXToolbox {
    const apiKey = process.env.MXTOOLBOX_API_KEY;
    if (!apiKey) throw new Error('MXTOOLBOX_API_KEY is required');
    return new MXToolbox({ apiKey });
  }

  async mxLookup(domain: string): Promise<MXLookupResult> { return this.client.request<MXLookupResult>(`/lookup/mx/${domain}`); }
  async dnsLookup(domain: string): Promise<MXLookupResult> { return this.client.request<MXLookupResult>(`/lookup/dns/${domain}`); }
  async spfLookup(domain: string): Promise<MXLookupResult> { return this.client.request<MXLookupResult>(`/lookup/spf/${domain}`); }
  async dkimLookup(domain: string, selector?: string): Promise<MXLookupResult> {
    return this.client.request<MXLookupResult>(`/lookup/dkim/${selector ? `${selector}:` : ''}${domain}`);
  }
  async dmarcLookup(domain: string): Promise<MXLookupResult> { return this.client.request<MXLookupResult>(`/lookup/dmarc/${domain}`); }
  async blacklistCheck(ip: string): Promise<MXLookupResult> { return this.client.request<MXLookupResult>(`/lookup/blacklist/${ip}`); }
  async aLookup(domain: string): Promise<MXLookupResult> { return this.client.request<MXLookupResult>(`/lookup/a/${domain}`); }
  async ptrLookup(ip: string): Promise<MXLookupResult> { return this.client.request<MXLookupResult>(`/lookup/ptr/${ip}`); }
  async sslLookup(domain: string): Promise<MXLookupResult> { return this.client.request<MXLookupResult>(`/lookup/https/${domain}`); }

  async listMonitors(): Promise<MXMonitor[]> { return this.client.request<MXMonitor[]>('/monitor'); }
  async getUsage(): Promise<MXUsage> { return this.client.request<MXUsage>('/usage'); }

  getClient(): MXToolboxClient { return this.client; }
}
