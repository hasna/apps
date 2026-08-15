import type { UpstashApiPlatformConfig } from '../types';
import { UpstashApiPlatformClient } from './client';
import { TeamsApi } from './teams';
import { VectorApi } from './vector';
import { AccountApi } from './account';
import type { RequestOptions } from './client';

export { UpstashApiPlatformClient, DEFAULT_BASE_URL, AUDIT_LOGS_BASE_URL } from './client';
export { TeamsApi } from './teams';
export { VectorApi } from './vector';
export { AccountApi } from './account';

export class UpstashApiPlatform {
  private readonly client: UpstashApiPlatformClient;
  readonly teams: TeamsApi;
  readonly vector: VectorApi;
  readonly account: AccountApi;

  constructor(config: UpstashApiPlatformConfig) {
    this.client = new UpstashApiPlatformClient(config);
    this.teams = new TeamsApi(this.client);
    this.vector = new VectorApi(this.client);
    this.account = new AccountApi(this.client);
  }

  getClient(): UpstashApiPlatformClient {
    return this.client;
  }

  async rawRequest<T = unknown>(
    method: RequestOptions['method'],
    path: string,
    options: Omit<RequestOptions, 'method'> = {},
  ): Promise<T> {
    return this.client.request<T>(path, { method, ...options });
  }

  listTeams() {
    return this.teams.listTeams();
  }

  createTeam(body: Parameters<TeamsApi['createTeam']>[0]) {
    return this.teams.createTeam(body);
  }

  getTeamMembers(teamId: string) {
    return this.teams.getTeamMembers(teamId);
  }

  listVectorIndices() {
    return this.vector.listIndices();
  }

  getVectorIndex(id: string) {
    return this.vector.getIndex(id);
  }

  createVectorIndex(body: Parameters<VectorApi['createIndex']>[0]) {
    return this.vector.createIndex(body);
  }

  deleteVectorIndex(id: string) {
    return this.vector.deleteIndex(id);
  }

  listAuditLogs() {
    return this.account.listAuditLogs();
  }
}
