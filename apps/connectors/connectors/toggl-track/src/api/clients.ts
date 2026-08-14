import type { TogglTrackClient } from './client';
import type { CreateClientParams, TogglClient, UpdateClientParams } from '../types';

export class ClientsApi {
  constructor(private readonly client: TogglTrackClient) {}

  list(
    workspaceId: number,
    options: { status?: 'active' | 'archived' | 'both'; name?: string } = {},
  ): Promise<TogglClient[]> {
    return this.client.get<TogglClient[]>(`/workspaces/${workspaceId}/clients`, {
      status: options.status,
      name: options.name,
    });
  }

  create(workspaceId: number, params: CreateClientParams): Promise<TogglClient> {
    return this.client.post<TogglClient>(`/workspaces/${workspaceId}/clients`, params);
  }

  update(workspaceId: number, clientId: number, params: UpdateClientParams): Promise<TogglClient> {
    return this.client.put<TogglClient>(`/workspaces/${workspaceId}/clients/${clientId}`, params);
  }

  delete(workspaceId: number, clientId: number): Promise<void> {
    return this.client.delete<void>(`/workspaces/${workspaceId}/clients/${clientId}`);
  }
}
