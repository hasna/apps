// Faros Connector — Engineering intelligence and developer productivity analytics
import { FarosClient } from './client';
import type { FarosConfig, FarosDeployment, FarosBuild, FarosIncident, FarosTeam, FarosQueryResult } from '../types';
export { FarosClient } from './client';

export class Faros {
  private readonly client: FarosClient;
  constructor(config: FarosConfig) { this.client = new FarosClient(config); }
  static fromEnv(): Faros {
    const apiKey = process.env.FAROS_API_KEY;
    if (!apiKey) throw new Error('FAROS_API_KEY is required');
    return new Faros({ apiKey, baseUrl: process.env.FAROS_BASE_URL });
  }

  async query(query: string): Promise<FarosQueryResult> {
    return this.client.request<FarosQueryResult>('/graphs/default/query', { method: 'POST', body: { query } });
  }

  async listDeployments(options?: { application?: string; limit?: number }): Promise<FarosDeployment[]> {
    return this.client.request<FarosDeployment[]>('/graphs/default/deployments', { params: { application: options?.application, limit: options?.limit } });
  }

  async listBuilds(options?: { pipeline?: string; limit?: number }): Promise<FarosBuild[]> {
    return this.client.request<FarosBuild[]>('/graphs/default/builds', { params: { pipeline: options?.pipeline, limit: options?.limit } });
  }

  async listIncidents(options?: { status?: string; severity?: string; limit?: number }): Promise<FarosIncident[]> {
    return this.client.request<FarosIncident[]>('/graphs/default/incidents', { params: { status: options?.status, severity: options?.severity, limit: options?.limit } });
  }

  async listTeams(): Promise<FarosTeam[]> { return this.client.request<FarosTeam[]>('/graphs/default/teams'); }
  async getTeam(teamUid: string): Promise<FarosTeam> { return this.client.request<FarosTeam>(`/graphs/default/teams/${teamUid}`); }

  async ingestData(origin: string, entries: Record<string, unknown>[]): Promise<{ entriesProcessed: number }> {
    return this.client.request('/graphs/default/revisions', { method: 'POST', body: { origin, entries } as Record<string, unknown> });
  }

  getClient(): FarosClient { return this.client; }
}
