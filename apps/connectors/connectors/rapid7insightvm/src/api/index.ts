// Rapid7 InsightVM Connector — Vulnerability management and risk assessment
import { Rapid7Client } from './client';
import type { Rapid7Config, R7Asset, R7AssetList, R7Vulnerability, R7Scan, R7Site, R7Report } from '../types';
export { Rapid7Client } from './client';

export class Rapid7InsightVM {
  private readonly client: Rapid7Client;
  constructor(config: Rapid7Config) { this.client = new Rapid7Client(config); }
  static fromEnv(): Rapid7InsightVM {
    const url = process.env.RAPID7_URL;
    const username = process.env.RAPID7_USERNAME;
    const password = process.env.RAPID7_PASSWORD;
    if (!url || !username || !password) throw new Error('RAPID7_URL, RAPID7_USERNAME, and RAPID7_PASSWORD are required');
    return new Rapid7InsightVM({ url, username, password });
  }

  async listAssets(options?: { page?: number; size?: number; sort?: string }): Promise<R7AssetList> {
    return this.client.request<R7AssetList>('/assets', { params: { page: options?.page, size: options?.size, sort: options?.sort } });
  }
  async getAsset(assetId: number): Promise<R7Asset> { return this.client.request<R7Asset>(`/assets/${assetId}`); }
  async getAssetVulnerabilities(assetId: number): Promise<{ resources: R7Vulnerability[] }> {
    return this.client.request(`/assets/${assetId}/vulnerabilities`);
  }

  async getVulnerability(vulnId: string): Promise<R7Vulnerability> { return this.client.request<R7Vulnerability>(`/vulnerabilities/${vulnId}`); }
  async searchVulnerabilities(query: string): Promise<{ resources: R7Vulnerability[] }> {
    return this.client.request('/vulnerabilities', { params: { query } });
  }

  async listScans(options?: { page?: number; size?: number }): Promise<{ resources: R7Scan[] }> {
    return this.client.request('/scans', { params: { page: options?.page, size: options?.size } });
  }
  async getScan(scanId: number): Promise<R7Scan> { return this.client.request<R7Scan>(`/scans/${scanId}`); }

  async listSites(options?: { page?: number; size?: number }): Promise<{ resources: R7Site[] }> {
    return this.client.request('/sites', { params: { page: options?.page, size: options?.size } });
  }
  async getSite(siteId: number): Promise<R7Site> { return this.client.request<R7Site>(`/sites/${siteId}`); }

  async listReports(): Promise<{ resources: R7Report[] }> { return this.client.request('/reports'); }

  getClient(): Rapid7Client { return this.client; }
}
