// SSLMate CertSpotter Connector — Certificate transparency monitoring and SSL cert search
import { CertSpotterClient } from './client';
import type { CertSpotterConfig, CSIssuance } from '../types';
export { CertSpotterClient } from './client';

export class CertSpotter {
  private readonly client: CertSpotterClient;
  constructor(config: CertSpotterConfig) { this.client = new CertSpotterClient(config); }
  static fromEnv(): CertSpotter {
    const apiKey = process.env.CERTSPOTTER_API_KEY;
    if (!apiKey) throw new Error('CERTSPOTTER_API_KEY is required');
    return new CertSpotter({ apiKey });
  }

  async getIssuances(domain: string, options?: { include_subdomains?: boolean; match_wildcards?: boolean; after?: string; expand?: string }): Promise<CSIssuance[]> {
    return this.client.request<CSIssuance[]>('/issuances', { domain, include_subdomains: options?.include_subdomains, match_wildcards: options?.match_wildcards, after: options?.after, expand: options?.expand });
  }

  async getIssuance(issuanceId: string): Promise<CSIssuance> {
    return this.client.request<CSIssuance>(`/issuances/${issuanceId}`);
  }

  async getSubdomains(domain: string, options?: { include_subdomains?: boolean; match_wildcards?: boolean }): Promise<string[]> {
    const issuances = await this.getIssuances(domain, { include_subdomains: options?.include_subdomains ?? true, match_wildcards: options?.match_wildcards });
    const subdomains = new Set<string>();
    issuances.forEach(i => i.dns_names.forEach(name => subdomains.add(name)));
    return Array.from(subdomains).sort();
  }

  getClient(): CertSpotterClient { return this.client; }
}
