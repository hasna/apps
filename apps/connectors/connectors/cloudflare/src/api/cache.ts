import type { CloudflareClient } from './client';
import type { CachePurgeParams, CachePurgeResponse, CloudflareResponse } from '../types';

export class CacheApi {
  constructor(private client: CloudflareClient) {}

  /**
   * Purge all cached content for a zone
   */
  async purgeAll(zoneId: string): Promise<CachePurgeResponse> {
    const response = await this.client.post<CachePurgeResponse>(
      `/zones/${zoneId}/purge_cache`,
      { purge_everything: true }
    );
    return response.result;
  }

  /**
   * Purge cached content by URLs
   */
  async purgeByUrls(zoneId: string, urls: string[]): Promise<CachePurgeResponse> {
    const response = await this.client.post<CachePurgeResponse>(
      `/zones/${zoneId}/purge_cache`,
      { files: urls }
    );
    return response.result;
  }

  /**
   * Purge cached content by cache tags
   */
  async purgeByTags(zoneId: string, tags: string[]): Promise<CachePurgeResponse> {
    const response = await this.client.post<CachePurgeResponse>(
      `/zones/${zoneId}/purge_cache`,
      { tags }
    );
    return response.result;
  }

  /**
   * Purge cached content by hostnames
   */
  async purgeByHosts(zoneId: string, hosts: string[]): Promise<CachePurgeResponse> {
    const response = await this.client.post<CachePurgeResponse>(
      `/zones/${zoneId}/purge_cache`,
      { hosts }
    );
    return response.result;
  }

  /**
   * Purge cached content by prefixes
   */
  async purgeByPrefixes(zoneId: string, prefixes: string[]): Promise<CachePurgeResponse> {
    const response = await this.client.post<CachePurgeResponse>(
      `/zones/${zoneId}/purge_cache`,
      { prefixes }
    );
    return response.result;
  }

  /**
   * Purge cached content with flexible params
   */
  async purge(zoneId: string, params: CachePurgeParams): Promise<CachePurgeResponse> {
    const response = await this.client.post<CachePurgeResponse>(
      `/zones/${zoneId}/purge_cache`,
      params as Record<string, unknown>
    );
    return response.result;
  }

  // ============================================
  // Cache Reserve
  // ============================================

  /**
   * Get Cache Reserve status for a zone
   */
  async getCacheReserve(zoneId: string): Promise<{
    id: string;
    value: 'on' | 'off';
    modified_on?: string;
  }> {
    const response = await this.client.get<{
      id: string;
      value: 'on' | 'off';
      modified_on?: string;
    }>(`/zones/${zoneId}/cache/cache_reserve`);
    return response.result;
  }

  /**
   * Enable Cache Reserve for a zone
   */
  async enableCacheReserve(zoneId: string): Promise<void> {
    await this.client.patch(`/zones/${zoneId}/cache/cache_reserve`, { value: 'on' });
  }

  /**
   * Disable Cache Reserve for a zone
   */
  async disableCacheReserve(zoneId: string): Promise<void> {
    await this.client.patch(`/zones/${zoneId}/cache/cache_reserve`, { value: 'off' });
  }

  /**
   * Clear Cache Reserve for a zone
   */
  async clearCacheReserve(zoneId: string): Promise<{
    id: string;
    start_ts: string;
    end_ts?: string;
    state: string;
  }> {
    const response = await this.client.post<{
      id: string;
      start_ts: string;
      end_ts?: string;
      state: string;
    }>(`/zones/${zoneId}/cache/cache_reserve_clear`);
    return response.result;
  }

  // ============================================
  // Tiered Cache
  // ============================================

  /**
   * Get Tiered Cache settings for a zone
   */
  async getTieredCache(zoneId: string): Promise<{
    id: string;
    value: 'on' | 'off';
    modified_on?: string;
  }> {
    const response = await this.client.get<{
      id: string;
      value: 'on' | 'off';
      modified_on?: string;
    }>(`/zones/${zoneId}/cache/tiered_cache_smart_topology_enable`);
    return response.result;
  }

  /**
   * Enable Tiered Cache for a zone
   */
  async enableTieredCache(zoneId: string): Promise<void> {
    await this.client.patch(`/zones/${zoneId}/cache/tiered_cache_smart_topology_enable`, { value: 'on' });
  }

  /**
   * Disable Tiered Cache for a zone
   */
  async disableTieredCache(zoneId: string): Promise<void> {
    await this.client.patch(`/zones/${zoneId}/cache/tiered_cache_smart_topology_enable`, { value: 'off' });
  }

  // ============================================
  // Regional Tiered Cache
  // ============================================

  /**
   * Get Regional Tiered Cache settings for a zone
   */
  async getRegionalTieredCache(zoneId: string): Promise<{
    id: string;
    value: 'on' | 'off';
    modified_on?: string;
  }> {
    const response = await this.client.get<{
      id: string;
      value: 'on' | 'off';
      modified_on?: string;
    }>(`/zones/${zoneId}/cache/regional_tiered_cache`);
    return response.result;
  }

  /**
   * Enable Regional Tiered Cache for a zone
   */
  async enableRegionalTieredCache(zoneId: string): Promise<void> {
    await this.client.patch(`/zones/${zoneId}/cache/regional_tiered_cache`, { value: 'on' });
  }

  /**
   * Disable Regional Tiered Cache for a zone
   */
  async disableRegionalTieredCache(zoneId: string): Promise<void> {
    await this.client.patch(`/zones/${zoneId}/cache/regional_tiered_cache`, { value: 'off' });
  }
}
