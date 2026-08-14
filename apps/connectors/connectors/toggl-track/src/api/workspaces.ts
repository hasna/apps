import type { TogglTrackClient } from './client';
import type { TogglWorkspace } from '../types';

export class WorkspacesApi {
  constructor(private readonly client: TogglTrackClient) {}

  get(workspaceId: number): Promise<TogglWorkspace> {
    return this.client.get<TogglWorkspace>(`/workspaces/${workspaceId}`);
  }
}
