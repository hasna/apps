import type { TogglTrackClient } from './client';
import type { TogglGroup, TogglWorkspaceUser } from '../types';

export class UsersApi {
  constructor(private readonly client: TogglTrackClient) {}

  listWorkspaceUsers(workspaceId: number): Promise<TogglWorkspaceUser[]> {
    return this.client.get<TogglWorkspaceUser[]>(`/workspaces/${workspaceId}/users`);
  }

  listGroups(workspaceId: number): Promise<TogglGroup[]> {
    return this.client.get<TogglGroup[]>(`/workspaces/${workspaceId}/groups`);
  }

  listProjectUsers(workspaceId: number, projectId: number): Promise<TogglWorkspaceUser[]> {
    return this.client.get<TogglWorkspaceUser[]>(
      `/workspaces/${workspaceId}/projects/${projectId}/users`,
    );
  }
}
