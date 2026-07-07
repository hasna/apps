import type { TogglTrackClient } from './client';
import type {
  CreateProjectParams,
  ListProjectsOptions,
  TogglProject,
  UpdateProjectParams,
} from '../types';

export class ProjectsApi {
  constructor(private readonly client: TogglTrackClient) {}

  list(workspaceId: number, options: ListProjectsOptions = {}): Promise<TogglProject[]> {
    return this.client.get<TogglProject[]>(`/workspaces/${workspaceId}/projects`, {
      active: typeof options.active === 'boolean' ? String(options.active) : options.active,
      since: options.sinceDate,
      billable: options.billable,
      user_ids: options.userIds?.map(String),
      client_ids: options.clientIds?.map(String),
      group_ids: options.groupIds?.map(String),
      statuses: options.statuses,
      name: options.name,
      sort_field: options.sortField,
      sort_order: options.sortOrder,
      per_page: options.perPage,
      page: options.page,
    });
  }

  get(workspaceId: number, projectId: number): Promise<TogglProject> {
    return this.client.get<TogglProject>(`/workspaces/${workspaceId}/projects/${projectId}`);
  }

  create(workspaceId: number, params: CreateProjectParams): Promise<TogglProject> {
    return this.client.post<TogglProject>(`/workspaces/${workspaceId}/projects`, params);
  }

  update(workspaceId: number, projectId: number, params: UpdateProjectParams): Promise<TogglProject> {
    return this.client.put<TogglProject>(`/workspaces/${workspaceId}/projects/${projectId}`, params);
  }

  delete(workspaceId: number, projectId: number): Promise<void> {
    return this.client.delete<void>(`/workspaces/${workspaceId}/projects/${projectId}`);
  }
}
