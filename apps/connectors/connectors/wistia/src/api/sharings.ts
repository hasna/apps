import type { WistiaClient } from './client';
import type { WistiaSharing, CreateSharingParams } from '../types';

export class SharingsApi {
  constructor(private readonly client: WistiaClient) {}

  async listProjectSharings(projectId: string): Promise<WistiaSharing[]> {
    return this.client.get<WistiaSharing[]>(
      `/v1/projects/${encodeURIComponent(projectId)}/sharings.json`,
    );
  }

  async createProjectSharing(
    projectId: string,
    params: CreateSharingParams,
  ): Promise<WistiaSharing> {
    return this.client.post<WistiaSharing>(
      `/v1/projects/${encodeURIComponent(projectId)}/sharings.json`,
      {
        email: params.email,
        access_level: params.permission,
      },
    );
  }

  async deleteProjectSharing(projectId: string, sharingId: string): Promise<void> {
    await this.client.delete(
      `/v1/projects/${encodeURIComponent(projectId)}/sharings/${encodeURIComponent(sharingId)}.json`,
    );
  }
}
