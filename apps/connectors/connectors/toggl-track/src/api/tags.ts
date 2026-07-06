import type { TogglTrackClient } from './client';
import type { TogglTag } from '../types';

export class TagsApi {
  constructor(private readonly client: TogglTrackClient) {}

  list(workspaceId: number): Promise<TogglTag[]> {
    return this.client.get<TogglTag[]>(`/workspaces/${workspaceId}/tags`);
  }

  create(workspaceId: number, name: string): Promise<TogglTag> {
    return this.client.post<TogglTag>(`/workspaces/${workspaceId}/tags`, { name });
  }

  delete(workspaceId: number, tagId: number): Promise<void> {
    return this.client.delete<void>(`/workspaces/${workspaceId}/tags/${tagId}`);
  }
}
