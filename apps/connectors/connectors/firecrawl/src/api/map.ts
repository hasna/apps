import type { FirecrawlClient } from './client';
import type { MapRequest, MapResponse } from '../types';

/**
 * Map API - Discover URLs on a website
 */
export class MapApi {
  constructor(private readonly client: FirecrawlClient) {}

  /**
   * Map a website to discover all its URLs
   * @param url - The website URL to map
   * @param options - Map options
   */
  async map(url: string, options?: Omit<MapRequest, 'url'>): Promise<MapResponse> {
    const body: MapRequest = {
      url,
      ...options,
    };

    return this.client.post<MapResponse>('/map', body);
  }

  /**
   * Search for specific URLs on a website
   * @param url - The website URL
   * @param search - Search query to filter URLs
   * @param limit - Maximum number of URLs to return
   */
  async search(url: string, search: string, limit?: number): Promise<MapResponse> {
    return this.map(url, { search, limit });
  }

  /**
   * Map only the sitemap URLs
   * @param url - The website URL
   * @param limit - Maximum number of URLs to return
   */
  async sitemapOnly(url: string, limit?: number): Promise<MapResponse> {
    return this.map(url, { sitemapOnly: true, limit });
  }

  /**
   * Map including subdomains
   * @param url - The website URL
   * @param limit - Maximum number of URLs to return
   */
  async withSubdomains(url: string, limit?: number): Promise<MapResponse> {
    return this.map(url, { includeSubdomains: true, limit });
  }
}
