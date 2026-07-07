import { StoplightClient } from './client';
import type {
  StoplightConfig,
  StoplightProject,
  StoplightSearchResult,
  RawRequestOptions,
} from '../types';

export { StoplightClient, DEFAULT_BASE_URL } from './client';

export class Stoplight {
  private client: StoplightClient;

  constructor(config: StoplightConfig) {
    this.client = new StoplightClient(config);
  }

  getClient(): StoplightClient {
    return this.client;
  }

  async listProjects(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get('/projects', params);
  }

  async createProject(body: Record<string, unknown>): Promise<StoplightProject> {
    return this.client.post<StoplightProject>('/projects', body);
  }

  async getProject(projectId: string): Promise<StoplightProject> {
    return this.client.get<StoplightProject>(`/projects/${encodeURIComponent(projectId)}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get('/events', params);
  }

  async search(body: Record<string, unknown>): Promise<StoplightSearchResult> {
    return this.client.post<StoplightSearchResult>('/search', body);
  }

  async rawRequest(path: string, options: RawRequestOptions = {}): Promise<unknown> {
    const { method = 'GET', query, body, headers } = options;
    return this.client.request(path, { method, params: query, body, headers });
  }
}
