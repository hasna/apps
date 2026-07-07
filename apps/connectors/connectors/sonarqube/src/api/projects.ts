import type { SonarQubeClient } from './client';
import type { Project, ProjectsSearchResponse } from '../types';

export class ProjectsApi {
  constructor(private readonly client: SonarQubeClient) {}

  async search(options?: {
    q?: string;
    qualifiers?: string | string[];
    p?: number;
    ps?: number;
    organization?: string;
  }): Promise<ProjectsSearchResponse> {
    return this.client.get<ProjectsSearchResponse>('/api/projects/search', options);
  }

  async show(component: string): Promise<{ component: Project }> {
    return this.client.get<{ component: Project }>('/api/components/show', { component });
  }

  async create(options: {
    project: string;
    name: string;
    mainBranch?: string;
    visibility?: 'public' | 'private';
    organization?: string;
  }): Promise<Project> {
    return this.client.post<Project>('/api/projects/create', options);
  }

  async delete(project: string): Promise<void> {
    await this.client.post('/api/projects/delete', { project });
  }
}
