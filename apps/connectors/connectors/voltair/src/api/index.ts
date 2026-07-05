import type {
  QueryParams,
  RawRequestOptions,
  VoltairConfig,
  VoltairProject,
  VoltairProjectsListResponse,
  VoltairRun,
} from '../types';
import { VoltairClient } from './client';
import { ProjectsApi } from './projects';

export class Voltair {
  private readonly client: VoltairClient;
  private readonly projectsApi: ProjectsApi;

  constructor(config: VoltairConfig) {
    this.client = new VoltairClient(config);
    this.projectsApi = new ProjectsApi(this.client);
  }

  static fromEnv(): Voltair {
    const apiKey = process.env.VOLTAIR_API_KEY;
    if (!apiKey) {
      throw new Error('VOLTAIR_API_KEY environment variable is required');
    }
    return new Voltair({
      apiKey,
      baseUrl: process.env.VOLTAIR_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  listProjects(query?: QueryParams): Promise<VoltairProjectsListResponse> {
    return this.projectsApi.listProjects(query);
  }

  getProject(projectId: string): Promise<VoltairProject> {
    return this.projectsApi.getProject(projectId);
  }

  createRun(projectId: string, body: Record<string, unknown> = {}): Promise<VoltairRun> {
    return this.projectsApi.createRun(projectId, body);
  }

  getRun(projectId: string, runId: string): Promise<VoltairRun> {
    return this.projectsApi.getRun(projectId, runId);
  }

  rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    return this.projectsApi.rawRequest<T>(options);
  }

  getClient(): VoltairClient {
    return this.client;
  }
}

export { VoltairClient, encodePathSegment, DEFAULT_BASE_URL } from './client';
export { ProjectsApi } from './projects';
