// npm Connector — npm registry API for package search, metadata, and downloads
import { NpmClient } from './client';
import type { NpmConfig, NpmPackage, NpmVersion, NpmSearchResult, NpmDownloads, NpmDownloadsRange } from '../types';
export { NpmClient } from './client';

export class Npm {
  private readonly client: NpmClient;
  constructor(config: NpmConfig = {}) { this.client = new NpmClient(config); }
  static fromEnv(): Npm {
    return new Npm({ token: process.env.NPM_TOKEN });
  }

  async getPackage(name: string): Promise<NpmPackage> { return this.client.registryRequest<NpmPackage>(`/${encodeURIComponent(name)}`); }
  async getVersion(name: string, version: string): Promise<NpmVersion> { return this.client.registryRequest<NpmVersion>(`/${encodeURIComponent(name)}/${version}`); }
  async getLatest(name: string): Promise<NpmVersion> { return this.client.registryRequest<NpmVersion>(`/${encodeURIComponent(name)}/latest`); }

  async search(query: string, options?: { size?: number; from?: number }): Promise<NpmSearchResult> {
    const params = new URLSearchParams({ text: query });
    if (options?.size) params.append('size', String(options.size));
    if (options?.from) params.append('from', String(options.from));
    return this.client.registryRequest<NpmSearchResult>(`/-/v1/search?${params}`);
  }

  async getDownloads(name: string, period?: string): Promise<NpmDownloads> {
    return this.client.apiRequest<NpmDownloads>(`/downloads/point/${period || 'last-week'}/${encodeURIComponent(name)}`);
  }
  async getDownloadsRange(name: string, period?: string): Promise<NpmDownloadsRange> {
    return this.client.apiRequest<NpmDownloadsRange>(`/downloads/range/${period || 'last-month'}/${encodeURIComponent(name)}`);
  }

  getClient(): NpmClient { return this.client; }
}
