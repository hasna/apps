import type { TogglTrackClient } from './client';
import type { TogglOrganization, TogglProject, TogglUser, TogglWorkspace } from '../types';

export class MeApi {
  constructor(private readonly client: TogglTrackClient) {}

  getCurrentUser(): Promise<TogglUser> {
    return this.client.get<TogglUser>('/me');
  }

  listMyWorkspaces(): Promise<TogglWorkspace[]> {
    return this.client.get<TogglWorkspace[]>('/me/workspaces');
  }

  listMyProjects(options: { includeArchived?: boolean } = {}): Promise<TogglProject[]> {
    return this.client.get<TogglProject[]>('/me/projects', {
      include_archived: options.includeArchived,
    });
  }

  listMyClients(): Promise<unknown[]> {
    return this.client.get<unknown[]>('/me/clients');
  }

  listOrganizations(): Promise<TogglOrganization[]> {
    return this.client.get<TogglOrganization[]>('/me/organizations');
  }

  getFeatures(): Promise<unknown> {
    return this.client.get<unknown>('/me/features');
  }
}
