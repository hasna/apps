// Cortex Connector — Internal developer portal and service catalog
import { CortexClient } from './client';
import type { CortexConfig, CortexService, CortexServiceList, CortexScorecard, CortexScore, CortexTeam, CortexCatalogEntity } from '../types';
export { CortexClient } from './client';

export class Cortex {
  private readonly client: CortexClient;
  constructor(config: CortexConfig) { this.client = new CortexClient(config); }
  static fromEnv(): Cortex {
    const token = process.env.CORTEX_TOKEN;
    if (!token) throw new Error('CORTEX_TOKEN is required');
    return new Cortex({ token });
  }

  async listServices(options?: { page?: number; pageSize?: number; type?: string }): Promise<CortexServiceList> {
    return this.client.request<CortexServiceList>('/catalog', { params: { page: options?.page, pageSize: options?.pageSize, type: options?.type } });
  }
  async getService(tag: string): Promise<CortexService> { return this.client.request<CortexService>(`/catalog/${tag}`); }
  async createService(data: { tag: string; name: string; description?: string; type?: string; owners?: { name: string; email: string }[] }): Promise<CortexService> {
    return this.client.request<CortexService>('/catalog', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateService(tag: string, data: { name?: string; description?: string; type?: string }): Promise<CortexService> {
    return this.client.request<CortexService>(`/catalog/${tag}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteService(tag: string): Promise<void> { await this.client.request(`/catalog/${tag}`, { method: 'DELETE' }); }

  async listScorecards(): Promise<CortexScorecard[]> { return this.client.request<CortexScorecard[]>('/scorecards'); }
  async getScorecard(tag: string): Promise<CortexScorecard> { return this.client.request<CortexScorecard>(`/scorecards/${tag}`); }
  async getServiceScore(serviceTag: string, scorecardTag: string): Promise<CortexScore> {
    return this.client.request<CortexScore>(`/catalog/${serviceTag}/scorecards/${scorecardTag}`);
  }

  async listTeams(): Promise<CortexTeam[]> { return this.client.request<CortexTeam[]>('/teams'); }
  async getTeam(tag: string): Promise<CortexTeam> { return this.client.request<CortexTeam>(`/teams/${tag}`); }

  async searchCatalog(query: string): Promise<CortexCatalogEntity[]> {
    return this.client.request<CortexCatalogEntity[]>('/catalog/search', { params: { query } });
  }

  getClient(): CortexClient { return this.client; }
}
