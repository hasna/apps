import type { WebflowClient } from './client';
import type { Asset, CreateAssetInput, UploadAssetDetails } from '../types';

export interface ListAssetsOptions {
  offset?: number;
  limit?: number;
}

/**
 * Webflow Assets API
 */
export class AssetsApi {
  constructor(private readonly client: WebflowClient) {}

  /**
   * List all assets for a site
   */
  async list(siteId: string, options: ListAssetsOptions = {}): Promise<{ assets: Asset[]; pagination: { offset: number; limit: number; total: number } }> {
    const params: Record<string, string | number | boolean | undefined> = {
      offset: options.offset || 0,
      limit: options.limit || 100,
    };

    return this.client.request<{ assets: Asset[]; pagination: { offset: number; limit: number; total: number } }>(
      `/sites/${siteId}/assets`,
      { params }
    );
  }

  /**
   * Get a single asset by ID
   */
  async get(assetId: string): Promise<Asset> {
    return this.client.request<Asset>(`/assets/${assetId}`);
  }

  /**
   * Create an asset (get upload URL)
   * This returns upload details that can be used to upload the actual file
   */
  async create(siteId: string, asset: CreateAssetInput): Promise<{ uploadUrl: string; uploadDetails: Record<string, string>; asset: Asset }> {
    return this.client.request<{ uploadUrl: string; uploadDetails: Record<string, string>; asset: Asset }>(
      `/sites/${siteId}/assets`,
      { method: 'POST', body: asset }
    );
  }

  /**
   * Update asset metadata (alt text, display name)
   */
  async update(assetId: string, updates: { displayName?: string; altText?: string }): Promise<Asset> {
    return this.client.request<Asset>(
      `/assets/${assetId}`,
      { method: 'PATCH', body: updates }
    );
  }

  /**
   * Delete an asset
   */
  async delete(assetId: string): Promise<void> {
    await this.client.request<void>(
      `/assets/${assetId}`,
      { method: 'DELETE' }
    );
  }

  /**
   * List asset folders for a site
   */
  async listFolders(siteId: string): Promise<{ assetFolders: Array<{ id: string; displayName: string; parentFolder: string | null; createdOn: string }> }> {
    return this.client.request<{ assetFolders: Array<{ id: string; displayName: string; parentFolder: string | null; createdOn: string }> }>(
      `/sites/${siteId}/asset_folders`
    );
  }

  /**
   * Create an asset folder
   */
  async createFolder(siteId: string, displayName: string, parentFolder?: string): Promise<{ id: string; displayName: string; parentFolder: string | null; createdOn: string }> {
    const body: Record<string, string> = { displayName };
    if (parentFolder) body.parentFolder = parentFolder;

    return this.client.request<{ id: string; displayName: string; parentFolder: string | null; createdOn: string }>(
      `/sites/${siteId}/asset_folders`,
      { method: 'POST', body }
    );
  }
}
