import type {
  QueryParams,
  RawRequestOptions,
  VoltairProject,
  VoltairProjectsListResponse,
  VoltairRun,
} from '../types';
import { encodePathSegment, VoltairClient } from './client';

export class ProjectsApi {
  constructor(private readonly client: VoltairClient) {}

  listProjects(query?: QueryParams): Promise<VoltairProjectsListResponse> {
    return this.client.get<VoltairProjectsListResponse>('/projects', query);
  }

  getProject(projectId: string): Promise<VoltairProject> {
    return this.client.get<VoltairProject>(`/projects/${encodePathSegment(projectId)}`);
  }

  createRun(projectId: string, body: Record<string, unknown> = {}): Promise<VoltairRun> {
    return this.client.post<VoltairRun>(
      `/projects/${encodePathSegment(projectId)}/runs`,
      body,
    );
  }

  getRun(projectId: string, runId: string): Promise<VoltairRun> {
    return this.client.get<VoltairRun>(
      `/projects/${encodePathSegment(projectId)}/runs/${encodePathSegment(runId)}`,
    );
  }

  rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request<T>(path, { method, query, body, headers });
  }
}
