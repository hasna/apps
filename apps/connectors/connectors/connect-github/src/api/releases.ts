import type { GitHubClient } from './client';
import type {
  Release,
  ReleaseAsset,
  CreateReleaseOptions,
  UpdateReleaseOptions,
} from '../types';

/**
 * GitHub Releases API
 */
export class ReleasesApi {
  constructor(private readonly client: GitHubClient) {}

  /**
   * List releases for a repository
   */
  async list(
    owner: string,
    repo: string,
    options?: { per_page?: number; page?: number }
  ): Promise<Release[]> {
    return this.client.get<Release[]>(`/repos/${owner}/${repo}/releases`, options);
  }

  /**
   * Get a release by ID
   */
  async get(owner: string, repo: string, releaseId: number): Promise<Release> {
    return this.client.get<Release>(`/repos/${owner}/${repo}/releases/${releaseId}`);
  }

  /**
   * Get the latest release
   */
  async getLatest(owner: string, repo: string): Promise<Release> {
    return this.client.get<Release>(`/repos/${owner}/${repo}/releases/latest`);
  }

  /**
   * Get a release by tag name
   */
  async getByTag(owner: string, repo: string, tag: string): Promise<Release> {
    return this.client.get<Release>(`/repos/${owner}/${repo}/releases/tags/${tag}`);
  }

  /**
   * Create a release
   */
  async create(
    owner: string,
    repo: string,
    tagName: string,
    options?: CreateReleaseOptions
  ): Promise<Release> {
    return this.client.post<Release>(`/repos/${owner}/${repo}/releases`, {
      tag_name: tagName,
      ...options,
    });
  }

  /**
   * Update a release
   */
  async update(
    owner: string,
    repo: string,
    releaseId: number,
    options: UpdateReleaseOptions
  ): Promise<Release> {
    return this.client.patch<Release>(
      `/repos/${owner}/${repo}/releases/${releaseId}`,
      options
    );
  }

  /**
   * Delete a release
   */
  async delete(owner: string, repo: string, releaseId: number): Promise<void> {
    await this.client.delete(`/repos/${owner}/${repo}/releases/${releaseId}`);
  }

  /**
   * List assets for a release
   */
  async listAssets(
    owner: string,
    repo: string,
    releaseId: number,
    options?: { per_page?: number; page?: number }
  ): Promise<ReleaseAsset[]> {
    return this.client.get<ReleaseAsset[]>(
      `/repos/${owner}/${repo}/releases/${releaseId}/assets`,
      options
    );
  }

  /**
   * Get a release asset
   */
  async getAsset(owner: string, repo: string, assetId: number): Promise<ReleaseAsset> {
    return this.client.get<ReleaseAsset>(`/repos/${owner}/${repo}/releases/assets/${assetId}`);
  }

  /**
   * Upload a release asset.
   * uploadUrl is the upload_url from the release (strip the {?name,label} template).
   */
  async uploadAsset(
    uploadUrl: string,
    name: string,
    data: Buffer | Uint8Array,
    contentType: string,
    label?: string
  ): Promise<ReleaseAsset> {
    const url = new URL(uploadUrl.replace(/\{[^}]+\}/, ''));
    url.searchParams.set('name', name);
    if (label) url.searchParams.set('label', label);

    const token = (this.client as unknown as { token: string }).token;
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: data,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload asset: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<ReleaseAsset>;
  }

  /**
   * Delete a release asset
   */
  async deleteAsset(owner: string, repo: string, assetId: number): Promise<void> {
    await this.client.delete(`/repos/${owner}/${repo}/releases/assets/${assetId}`);
  }

  /**
   * Update a release asset (rename or re-label)
   */
  async updateAsset(
    owner: string,
    repo: string,
    assetId: number,
    options: { name?: string; label?: string }
  ): Promise<ReleaseAsset> {
    return this.client.patch<ReleaseAsset>(
      `/repos/${owner}/${repo}/releases/assets/${assetId}`,
      options
    );
  }
}
