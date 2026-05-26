import type { WixClient } from './client';
import type { Site } from '../types';

export interface ListSitesOptions {
  limit?: number;
  offset?: number;
}

/**
 * Wix Sites API
 * Endpoint: /site-list/v2/sites
 */
export class SitesApi {
  constructor(private readonly client: WixClient) {}

  /**
   * List all sites for the account
   * This is an account-level API, doesn't require site ID
   */
  async list(options: ListSitesOptions = {}): Promise<Site[]> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options.limit) params.limit = options.limit;
    if (options.offset) params.offset = options.offset;

    const response = await this.client.request<{ sites: Record<string, unknown>[] }>(
      '/site-list/v2/sites/query',
      {
        method: 'POST',
        body: {
          query: {
            paging: {
              limit: options.limit || 50,
              offset: options.offset || 0,
            },
          },
        },
      }
    );

    return this.transformSites(response.sites || []);
  }

  /**
   * Get a single site by ID
   */
  async get(siteId: string): Promise<Site> {
    const response = await this.client.request<{ site: Record<string, unknown> }>(
      `/site-list/v2/sites/${siteId}`
    );

    return this.transformSite(response.site);
  }

  /**
   * Transform API response to our types
   */
  private transformSite(site: Record<string, unknown>): Site {
    return {
      id: site.id as string,
      name: site.name as string || site.siteDisplayName as string || '',
      url: site.url as string || '',
      description: site.description as string | undefined,
      createdDate: site.createdDate as string || site.dateCreated as string || '',
      published: site.published as boolean || false,
      thumbnailUrl: site.thumbnailUrl as string | undefined,
      siteDisplayName: site.siteDisplayName as string | undefined,
      namespace: site.namespace as string | undefined,
      viewUrl: site.viewUrl as string | undefined,
      editUrl: site.editUrl as string | undefined,
    };
  }

  private transformSites(sites: Record<string, unknown>[]): Site[] {
    return sites.map(s => this.transformSite(s));
  }
}
