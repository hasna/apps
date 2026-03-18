// VirusTotal Connector — File and URL malware scanning and threat intelligence
import { VirusTotalClient } from './client';
import type { VirusTotalConfig, VTFileReport, VTUrlReport, VTDomainReport, VTScanResult } from '../types';
export { VirusTotalClient } from './client';

export class VirusTotal {
  private readonly client: VirusTotalClient;
  constructor(config: VirusTotalConfig) { this.client = new VirusTotalClient(config); }
  static fromEnv(): VirusTotal {
    const apiKey = process.env.VIRUSTOTAL_API_KEY;
    if (!apiKey) throw new Error('VIRUSTOTAL_API_KEY is required');
    return new VirusTotal({ apiKey });
  }

  async getFileReport(hash: string): Promise<VTFileReport> { return this.client.request<VTFileReport>(`/files/${hash}`); }
  async scanUrl(url: string): Promise<VTScanResult> {
    return this.client.request<VTScanResult>('/urls', { method: 'POST', body: `url=${encodeURIComponent(url)}` });
  }
  async getUrlReport(urlId: string): Promise<VTUrlReport> { return this.client.request<VTUrlReport>(`/urls/${urlId}`); }
  async getDomainReport(domain: string): Promise<VTDomainReport> { return this.client.request<VTDomainReport>(`/domains/${domain}`); }
  async getIpReport(ip: string): Promise<VTDomainReport> { return this.client.request<VTDomainReport>(`/ip_addresses/${ip}`); }

  async getAnalysis(analysisId: string): Promise<{ data: { attributes: { status: string; stats: Record<string, number> } } }> {
    return this.client.request(`/analyses/${analysisId}`);
  }

  async searchFiles(query: string, options?: { limit?: number; cursor?: string }): Promise<{ data: VTFileReport['data'][] }> {
    return this.client.request('/intelligence/search', { params: { query, limit: options?.limit, cursor: options?.cursor } });
  }

  async getFileComments(hash: string, options?: { limit?: number }): Promise<{ data: { attributes: { text: string; date: number } }[] }> {
    return this.client.request(`/files/${hash}/comments`, { params: { limit: options?.limit } });
  }

  getClient(): VirusTotalClient { return this.client; }
}
