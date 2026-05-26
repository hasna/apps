// Bunny CDN Connector — Content delivery network and edge storage
import { BunnyCDNClient } from './client';
import type { BunnyCDNConfig, BunnyPullZone, BunnyStorageZone, BunnyStats } from '../types';
export { BunnyCDNClient } from './client';

export class BunnyCDN {
  private readonly client: BunnyCDNClient;
  constructor(config: BunnyCDNConfig) { this.client = new BunnyCDNClient(config); }
  static fromEnv(): BunnyCDN {
    const apiKey = process.env.BUNNYCDN_API_KEY;
    if (!apiKey) throw new Error('BUNNYCDN_API_KEY environment variable is required');
    return new BunnyCDN({ apiKey });
  }

  async listPullZones(): Promise<BunnyPullZone[]> { return this.client.request<BunnyPullZone[]>('/pullzone'); }
  async getPullZone(id: number): Promise<BunnyPullZone> { return this.client.request<BunnyPullZone>(`/pullzone/${id}`); }
  async createPullZone(data: { Name: string; OriginUrl: string; Type?: number }): Promise<BunnyPullZone> {
    return this.client.request<BunnyPullZone>('/pullzone', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deletePullZone(id: number): Promise<void> { await this.client.request(`/pullzone/${id}`, { method: 'DELETE' }); }
  async purgeCache(id: number): Promise<void> { await this.client.request(`/pullzone/${id}/purgeCache`, { method: 'POST' }); }
  async purgeUrl(url: string): Promise<void> { await this.client.request('/purge', { params: { url } }); }

  async listStorageZones(): Promise<BunnyStorageZone[]> { return this.client.request<BunnyStorageZone[]>('/storagezone'); }
  async getStorageZone(id: number): Promise<BunnyStorageZone> { return this.client.request<BunnyStorageZone>(`/storagezone/${id}`); }
  async createStorageZone(data: { Name: string; Region?: string }): Promise<BunnyStorageZone> {
    return this.client.request<BunnyStorageZone>('/storagezone', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteStorageZone(id: number): Promise<void> { await this.client.request(`/storagezone/${id}`, { method: 'DELETE' }); }

  async getStats(options?: { dateFrom?: string; dateTo?: string; pullZone?: number }): Promise<BunnyStats> {
    return this.client.request<BunnyStats>('/statistics', { params: options as Record<string, string | number | undefined> });
  }

  getClient(): BunnyCDNClient { return this.client; }
}
