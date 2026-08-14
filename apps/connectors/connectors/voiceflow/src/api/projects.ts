import type { VoiceflowClient } from './client';
import type {
  VoiceflowCreateProjectParams,
  VoiceflowProject,
  VoiceflowProjectListResponse,
} from '../types';

export class ProjectsApi {
  constructor(private readonly client: VoiceflowClient) {}

  async list(params?: Record<string, string | number | boolean | undefined>): Promise<VoiceflowProjectListResponse> {
    return this.client.get<VoiceflowProjectListResponse>('/projects', params);
  }

  async get(projectId: string): Promise<VoiceflowProject> {
    const encoded = encodeURIComponent(projectId);
    return this.client.get<VoiceflowProject>(`/projects/${encoded}`);
  }

  async create(params: VoiceflowCreateProjectParams): Promise<VoiceflowProject> {
    return this.client.post<VoiceflowProject>('/projects', params);
  }
}
