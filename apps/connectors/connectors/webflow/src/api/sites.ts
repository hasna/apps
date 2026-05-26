import type { WebflowClient } from './client';
import type { Site } from '../types';

/**
 * Webflow Sites API
 */
export class SitesApi {
  constructor(private readonly client: WebflowClient) {}

  /**
   * List all sites accessible by the access token
   */
  async list(): Promise<Site[]> {
    const response = await this.client.request<{ sites: Site[] }>('/sites');
    return response.sites;
  }

  /**
   * Get a single site by ID
   */
  async get(siteId: string): Promise<Site> {
    return this.client.request<Site>(`/sites/${siteId}`);
  }

  /**
   * Publish a site to one or more domains
   * @param siteId - The site ID
   * @param domains - Array of domain IDs to publish to (optional, publishes to all if not specified)
   */
  async publish(siteId: string, domains?: string[]): Promise<{ queued: boolean }> {
    const body: Record<string, unknown> = {};
    if (domains && domains.length > 0) {
      body.customDomains = domains;
    }

    return this.client.request<{ queued: boolean }>(
      `/sites/${siteId}/publish`,
      { method: 'POST', body: Object.keys(body).length > 0 ? body : undefined }
    );
  }
}
