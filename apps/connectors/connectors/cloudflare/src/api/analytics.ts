import type { CloudflareClient } from './client';
import type { ZoneAnalytics, AnalyticsQuery, CloudflareResponse } from '../types';

// GraphQL response types for zone analytics
interface GraphQLZoneAnalyticsResponse {
  data: {
    viewer: {
      zones: Array<{
        httpRequests1dGroups: Array<{
          dimensions: {
            date: string;
          };
          sum: {
            requests: number;
            bytes: number;
            threats: number;
            cachedRequests: number;
            cachedBytes: number;
            encryptedRequests: number;
            encryptedBytes: number;
            pageViews: number;
          };
          uniq: {
            uniques: number;
          };
        }>;
      }>;
    };
  };
  errors?: Array<{
    message: string;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
}

// Fallback response with fewer fields for free tier zones
interface GraphQLZoneAnalyticsSimpleResponse {
  data: {
    viewer: {
      zones: Array<{
        httpRequests1dGroups: Array<{
          dimensions: {
            date: string;
          };
          sum: {
            requests: number;
            bytes: number;
            threats: number;
            cachedRequests: number;
            cachedBytes: number;
            pageViews: number;
          };
          uniq: {
            uniques: number;
          };
        }>;
      }>;
    };
  };
  errors?: Array<{
    message: string;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
}

export class AnalyticsApi {
  constructor(private client: CloudflareClient) {}

  /**
   * Parse relative date strings like "-7d" into ISO date strings
   */
  private parseRelativeDate(dateStr: string): string {
    if (!dateStr.startsWith('-')) {
      // Assume it's already an ISO date or absolute date
      return dateStr;
    }

    const match = dateStr.match(/^-(\d+)([dhm])$/);
    if (!match) {
      return dateStr;
    }

    const [, amount, unit] = match;
    const now = new Date();

    switch (unit) {
      case 'd':
        now.setDate(now.getDate() - parseInt(amount));
        break;
      case 'h':
        now.setHours(now.getHours() - parseInt(amount));
        break;
      case 'm':
        now.setMinutes(now.getMinutes() - parseInt(amount));
        break;
    }

    return now.toISOString().split('T')[0];
  }

  /**
   * Get zone analytics dashboard data using GraphQL API
   * Note: This replaces the deprecated Zone Analytics API
   *
   * Uses Cloudflare's GraphQL Analytics API endpoint: POST https://api.cloudflare.com/client/v4/graphql
   * Documentation: https://developers.cloudflare.com/analytics/graphql-api/
   */
  async getDashboard(zoneId: string, params?: AnalyticsQuery): Promise<ZoneAnalytics> {
    // Parse date parameters
    const since = params?.since ? this.parseRelativeDate(params.since) : this.parseRelativeDate('-7d');
    const until = params?.until ? this.parseRelativeDate(params.until) : new Date().toISOString().split('T')[0];

    const variables = {
      zoneTag: zoneId,
      since,
      until,
    };

    // Try full query first, fallback to simple query if it fails
    try {
      return await this.getDashboardFull(variables);
    } catch (err) {
      // If full query fails (e.g., missing fields on free tier), try simpler query
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes('Cannot query field') || errorMsg.includes('Unknown field')) {
        return await this.getDashboardSimple(variables);
      }
      throw err;
    }
  }

  /**
   * Full dashboard query with all available fields
   */
  private async getDashboardFull(variables: { zoneTag: string; since: string; until: string }): Promise<ZoneAnalytics> {
    // GraphQL query for zone analytics - full version with all fields
    const query = `
      query GetZoneAnalytics($zoneTag: String!, $since: Date!, $until: Date!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequests1dGroups(
              limit: 100
              filter: { date_geq: $since, date_leq: $until }
              orderBy: [date_ASC]
            ) {
              dimensions {
                date
              }
              sum {
                requests
                bytes
                threats
                cachedRequests
                cachedBytes
                encryptedRequests
                encryptedBytes
                pageViews
              }
              uniq {
                uniques
              }
            }
          }
        }
      }
    `;

    const response = await this.graphqlQuery(query, variables) as GraphQLZoneAnalyticsResponse;

    // Check for GraphQL errors
    if (response.errors && response.errors.length > 0) {
      throw new Error(`GraphQL error: ${response.errors.map(e => e.message).join(', ')}`);
    }

    return this.transformGraphQLResponse(response, true);
  }

  /**
   * Simple dashboard query without encrypted fields (for zones that don't support them)
   */
  private async getDashboardSimple(variables: { zoneTag: string; since: string; until: string }): Promise<ZoneAnalytics> {
    // GraphQL query for zone analytics - simple version without encrypted fields
    const query = `
      query GetZoneAnalytics($zoneTag: String!, $since: Date!, $until: Date!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequests1dGroups(
              limit: 100
              filter: { date_geq: $since, date_leq: $until }
              orderBy: [date_ASC]
            ) {
              dimensions {
                date
              }
              sum {
                requests
                bytes
                threats
                cachedRequests
                cachedBytes
                pageViews
              }
              uniq {
                uniques
              }
            }
          }
        }
      }
    `;

    const response = await this.graphqlQuery(query, variables) as GraphQLZoneAnalyticsSimpleResponse;

    // Check for GraphQL errors
    if (response.errors && response.errors.length > 0) {
      throw new Error(`GraphQL error: ${response.errors.map(e => e.message).join(', ')}`);
    }

    return this.transformGraphQLResponse(response, false);
  }

  /**
   * Transform GraphQL response to ZoneAnalytics format
   */
  private transformGraphQLResponse(
    response: GraphQLZoneAnalyticsResponse | GraphQLZoneAnalyticsSimpleResponse,
    hasEncryptedFields: boolean
  ): ZoneAnalytics {
    // Transform GraphQL response to ZoneAnalytics format
    const zones = response.data?.viewer?.zones;
    if (!zones || zones.length === 0 || !zones[0].httpRequests1dGroups) {
      // Return empty analytics if no data
      return this.createEmptyAnalytics();
    }

    const groups = zones[0].httpRequests1dGroups;

    // Calculate totals from all groups
    const totals = groups.reduce(
      (acc, group) => {
        acc.requests.all += group.sum.requests || 0;
        acc.requests.cached += group.sum.cachedRequests || 0;
        acc.requests.uncached += (group.sum.requests || 0) - (group.sum.cachedRequests || 0);

        // Encrypted fields are optional
        const encryptedRequests = hasEncryptedFields ? ((group.sum as { encryptedRequests?: number }).encryptedRequests || 0) : 0;
        const encryptedBytes = hasEncryptedFields ? ((group.sum as { encryptedBytes?: number }).encryptedBytes || 0) : 0;

        acc.requests.ssl.encrypted += encryptedRequests;
        acc.requests.ssl.unencrypted += (group.sum.requests || 0) - encryptedRequests;

        acc.bandwidth.all += group.sum.bytes || 0;
        acc.bandwidth.cached += group.sum.cachedBytes || 0;
        acc.bandwidth.uncached += (group.sum.bytes || 0) - (group.sum.cachedBytes || 0);
        acc.bandwidth.ssl.encrypted += encryptedBytes;
        acc.bandwidth.ssl.unencrypted += (group.sum.bytes || 0) - encryptedBytes;

        acc.threats.all += group.sum.threats || 0;
        acc.pageviews.all += group.sum.pageViews || 0;
        acc.uniques.all += group.uniq?.uniques || 0;

        return acc;
      },
      this.createEmptyTotals()
    );

    // Create timeseries from groups
    const timeseries = groups.map(group => {
      const encryptedRequests = hasEncryptedFields ? ((group.sum as { encryptedRequests?: number }).encryptedRequests || 0) : 0;
      const encryptedBytes = hasEncryptedFields ? ((group.sum as { encryptedBytes?: number }).encryptedBytes || 0) : 0;

      return {
        since: `${group.dimensions.date}T00:00:00Z`,
        until: `${group.dimensions.date}T23:59:59Z`,
        requests: {
          all: group.sum.requests || 0,
          cached: group.sum.cachedRequests || 0,
          uncached: (group.sum.requests || 0) - (group.sum.cachedRequests || 0),
          content_type: {},
          country: {},
          ssl: {
            encrypted: encryptedRequests,
            unencrypted: (group.sum.requests || 0) - encryptedRequests,
          },
          http_status: {},
        },
        bandwidth: {
          all: group.sum.bytes || 0,
          cached: group.sum.cachedBytes || 0,
          uncached: (group.sum.bytes || 0) - (group.sum.cachedBytes || 0),
          content_type: {},
          country: {},
          ssl: {
            encrypted: encryptedBytes,
            unencrypted: (group.sum.bytes || 0) - encryptedBytes,
          },
        },
        threats: {
          all: group.sum.threats || 0,
          country: {},
          type: {},
        },
        pageviews: {
          all: group.sum.pageViews || 0,
          search_engines: {},
        },
        uniques: {
          all: group.uniq?.uniques || 0,
        },
      };
    });

    return {
      totals,
      timeseries,
    };
  }

  private createEmptyTotals() {
    return {
      requests: {
        all: 0,
        cached: 0,
        uncached: 0,
        content_type: {} as Record<string, number>,
        country: {} as Record<string, number>,
        ssl: { encrypted: 0, unencrypted: 0 },
        http_status: {} as Record<string, number>,
      },
      bandwidth: {
        all: 0,
        cached: 0,
        uncached: 0,
        content_type: {} as Record<string, number>,
        country: {} as Record<string, number>,
        ssl: { encrypted: 0, unencrypted: 0 },
      },
      threats: {
        all: 0,
        country: {} as Record<string, number>,
        type: {} as Record<string, number>,
      },
      pageviews: {
        all: 0,
        search_engines: {} as Record<string, number>,
      },
      uniques: {
        all: 0,
      },
    };
  }

  private createEmptyAnalytics(): ZoneAnalytics {
    return {
      totals: this.createEmptyTotals(),
      timeseries: [],
    };
  }

  /**
   * Get zone analytics colos (colocation data)
   */
  async getColos(zoneId: string, params?: AnalyticsQuery): Promise<{
    totals: Record<string, unknown>;
    timeseries: Array<Record<string, unknown>>;
  }> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.since) queryParams.since = params.since;
    if (params?.until) queryParams.until = params.until;
    if (params?.continuous !== undefined) queryParams.continuous = params.continuous;

    const response = await this.client.get<{
      totals: Record<string, unknown>;
      timeseries: Array<Record<string, unknown>>;
    }>(`/zones/${zoneId}/analytics/colos`, queryParams);
    return response.result;
  }

  // ============================================
  // DNS Analytics
  // ============================================

  /**
   * Get DNS analytics for a zone
   */
  async getDnsAnalytics(
    zoneId: string,
    params?: {
      since?: string;
      until?: string;
      dimensions?: string[];
      metrics?: string[];
      filters?: string;
      sort?: string[];
      limit?: number;
    }
  ): Promise<{
    rows: number;
    data: Array<Record<string, unknown>>;
    data_lag: number;
    min: Record<string, number>;
    max: Record<string, number>;
    totals: Record<string, number>;
    query: Record<string, unknown>;
  }> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.since) queryParams.since = params.since;
    if (params?.until) queryParams.until = params.until;
    if (params?.dimensions) queryParams.dimensions = params.dimensions.join(',');
    if (params?.metrics) queryParams.metrics = params.metrics.join(',');
    if (params?.filters) queryParams.filters = params.filters;
    if (params?.sort) queryParams.sort = params.sort.join(',');
    if (params?.limit) queryParams.limit = params.limit;

    const response = await this.client.get<{
      rows: number;
      data: Array<Record<string, unknown>>;
      data_lag: number;
      min: Record<string, number>;
      max: Record<string, number>;
      totals: Record<string, number>;
      query: Record<string, unknown>;
    }>(`/zones/${zoneId}/dns_analytics/report`, queryParams);
    return response.result;
  }

  /**
   * Get DNS analytics by time
   */
  async getDnsAnalyticsByTime(
    zoneId: string,
    params?: {
      since?: string;
      until?: string;
      dimensions?: string[];
      metrics?: string[];
      filters?: string;
      sort?: string[];
      limit?: number;
      time_delta?: 'minute' | 'hour' | 'day' | 'dekaminute' | 'all';
    }
  ): Promise<{
    rows: number;
    data: Array<Record<string, unknown>>;
    data_lag: number;
    min: Record<string, number>;
    max: Record<string, number>;
    totals: Record<string, number>;
    query: Record<string, unknown>;
  }> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.since) queryParams.since = params.since;
    if (params?.until) queryParams.until = params.until;
    if (params?.dimensions) queryParams.dimensions = params.dimensions.join(',');
    if (params?.metrics) queryParams.metrics = params.metrics.join(',');
    if (params?.filters) queryParams.filters = params.filters;
    if (params?.sort) queryParams.sort = params.sort.join(',');
    if (params?.limit) queryParams.limit = params.limit;
    if (params?.time_delta) queryParams.time_delta = params.time_delta;

    const response = await this.client.get<{
      rows: number;
      data: Array<Record<string, unknown>>;
      data_lag: number;
      min: Record<string, number>;
      max: Record<string, number>;
      totals: Record<string, number>;
      query: Record<string, unknown>;
    }>(`/zones/${zoneId}/dns_analytics/report/bytime`, queryParams);
    return response.result;
  }

  // ============================================
  // Workers Analytics
  // ============================================

  /**
   * Get Workers analytics for an account
   */
  async getWorkersAnalytics(
    accountId: string,
    params?: {
      since?: string;
      until?: string;
      script_name?: string;
    }
  ): Promise<{
    totals: {
      requests: number;
      errors: number;
      duration: number;
    };
    timeseries: Array<{
      since: string;
      until: string;
      requests: number;
      errors: number;
      duration: number;
    }>;
  }> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.since) queryParams.since = params.since;
    if (params?.until) queryParams.until = params.until;
    if (params?.script_name) queryParams.script_name = params.script_name;

    const response = await this.client.get<{
      totals: {
        requests: number;
        errors: number;
        duration: number;
      };
      timeseries: Array<{
        since: string;
        until: string;
        requests: number;
        errors: number;
        duration: number;
      }>;
    }>(`/accounts/${accountId}/workers/analytics/aggregate`, queryParams);
    return response.result;
  }

  // ============================================
  // Web Analytics (RUM)
  // ============================================

  /**
   * List Web Analytics sites
   */
  async listWebAnalyticsSites(
    accountId: string,
    params?: {
      page?: number;
      per_page?: number;
      order_by?: 'host' | 'created';
    }
  ): Promise<CloudflareResponse<Array<{
    site_tag: string;
    site_token: string;
    created: string;
    snippet: string;
    auto_install: boolean;
    ruleset: {
      id: string;
      zone_tag?: string;
      zone_name?: string;
      host?: string;
      paths?: string[];
      is_paused?: boolean;
    };
  }>>> {
    return this.client.get<Array<{
      site_tag: string;
      site_token: string;
      created: string;
      snippet: string;
      auto_install: boolean;
      ruleset: {
        id: string;
        zone_tag?: string;
        zone_name?: string;
        host?: string;
        paths?: string[];
        is_paused?: boolean;
      };
    }>>(`/accounts/${accountId}/rum/site_info/list`, params);
  }

  /**
   * Get Web Analytics site info
   */
  async getWebAnalyticsSite(accountId: string, siteTag: string): Promise<{
    site_tag: string;
    site_token: string;
    created: string;
    snippet: string;
    auto_install: boolean;
    ruleset: {
      id: string;
      zone_tag?: string;
      zone_name?: string;
      host?: string;
      paths?: string[];
      is_paused?: boolean;
    };
  }> {
    const response = await this.client.get<{
      site_tag: string;
      site_token: string;
      created: string;
      snippet: string;
      auto_install: boolean;
      ruleset: {
        id: string;
        zone_tag?: string;
        zone_name?: string;
        host?: string;
        paths?: string[];
        is_paused?: boolean;
      };
    }>(`/accounts/${accountId}/rum/site_info/${siteTag}`);
    return response.result;
  }

  // ============================================
  // GraphQL Analytics
  // ============================================

  /**
   * Query analytics using GraphQL
   * Note: The GraphQL endpoint returns data directly, not wrapped in Cloudflare's standard response format
   */
  async graphqlQuery(query: string, variables?: Record<string, unknown>): Promise<{
    data: Record<string, unknown>;
    errors?: Array<{
      message: string;
      path?: string[];
      extensions?: Record<string, unknown>;
    }>;
  }> {
    // Use request with rawResponse since GraphQL returns its own format, not Cloudflare's standard wrapper
    const response = await this.client.request<{
      data: Record<string, unknown>;
      errors?: Array<{
        message: string;
        path?: string[];
        extensions?: Record<string, unknown>;
      }>;
    }>('/graphql', {
      method: 'POST',
      body: { query, variables },
      rawResponse: true,
    });
    return response;
  }
}
