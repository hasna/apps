import type { TogglTrackClient } from './client';
import type { CreateTaskParams, ListTasksOptions, TogglTask } from '../types';

export class TasksApi {
  constructor(private readonly client: TogglTrackClient) {}

  list(workspaceId: number, options: ListTasksOptions = {}): Promise<TogglTask[]> {
    const path = options.projectId
      ? `/workspaces/${workspaceId}/projects/${options.projectId}/tasks`
      : `/workspaces/${workspaceId}/tasks`;

    return this.client.get<TogglTask[]>(path, {
      per_page: options.perPage,
      page: options.page,
      active: options.active,
    });
  }

  create(workspaceId: number, projectId: number, params: CreateTaskParams): Promise<TogglTask> {
    return this.client.post<TogglTask>(
      `/workspaces/${workspaceId}/projects/${projectId}/tasks`,
      params,
    );
  }
}
