import type { FigmaClient } from './client';
import type {
  DevResource,
  DevResourcesResponse,
  DevResourceCreateRequest,
} from '../types';

/**
 * Figma Dev Resources API
 */
export class DevResourcesApi {
  constructor(private readonly client: FigmaClient) {}

  /**
   * Get dev resources for a file
   * @param fileKey - The file key
   * @param nodeIds - Optional array of node IDs to filter by
   */
  async getDevResources(
    fileKey: string,
    nodeIds?: string[]
  ): Promise<DevResourcesResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (nodeIds && nodeIds.length > 0) {
      params.node_ids = nodeIds.join(',');
    }

    return this.client.request<DevResourcesResponse>(`/files/${fileKey}/dev_resources`, {
      params,
    });
  }

  /**
   * Create dev resources for a file
   * @param fileKey - The file key
   * @param devResources - Array of dev resources to create
   */
  async createDevResources(
    fileKey: string,
    devResources: DevResourceCreateRequest[]
  ): Promise<DevResourcesResponse> {
    return this.client.request<DevResourcesResponse>(`/files/${fileKey}/dev_resources`, {
      method: 'POST',
      body: { dev_resources: devResources },
    });
  }

  /**
   * Update a dev resource
   * @param fileKey - The file key
   * @param devResourceId - The dev resource ID
   * @param updates - Fields to update
   */
  async updateDevResource(
    fileKey: string,
    devResourceId: string,
    updates: {
      name?: string;
      url?: string;
    }
  ): Promise<DevResource> {
    return this.client.request<DevResource>(`/files/${fileKey}/dev_resources/${devResourceId}`, {
      method: 'PUT',
      body: updates,
    });
  }

  /**
   * Delete a dev resource
   * @param fileKey - The file key
   * @param devResourceId - The dev resource ID
   */
  async deleteDevResource(fileKey: string, devResourceId: string): Promise<void> {
    await this.client.request<void>(`/files/${fileKey}/dev_resources/${devResourceId}`, {
      method: 'DELETE',
    });
  }
}
