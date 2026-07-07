import type { ConnectorClient } from './client';
import { V3, toQuery } from './params';
import type {
  ListParams,
  Project,
  ProjectResponse,
  ProjectsResponse,
  CreateProjectParams,
  UpdateProjectParams,
} from '../types';

export class ProjectsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<ProjectsResponse> {
    return this.client.get<ProjectsResponse>(`${V3}/projects.json`, toQuery(params));
  }

  async get(id: number | string, include?: string): Promise<ProjectResponse> {
    return this.client.get<ProjectResponse>(`${V3}/projects/${id}.json`, include ? { include } : undefined);
  }

  async create(data: CreateProjectParams): Promise<ProjectResponse> {
    const project: Record<string, unknown> = { name: data.name };
    if (data.description !== undefined) project.description = data.description;
    if (data.startDate !== undefined) project.startDate = data.startDate;
    if (data.endDate !== undefined) project.endDate = data.endDate;
    if (data.companyId !== undefined) project.companyId = data.companyId;
    if (data.categoryId !== undefined) project.categoryId = data.categoryId;
    return this.client.post<ProjectResponse>(`${V3}/projects.json`, { project });
  }

  async update(id: number | string, data: UpdateProjectParams): Promise<ProjectResponse> {
    return this.client.patch<ProjectResponse>(`${V3}/projects/${id}.json`, { project: data });
  }

  async delete(id: number | string): Promise<void> {
    await this.client.delete<void>(`${V3}/projects/${id}.json`);
  }
}

export type { Project };
