import type { ExaClient } from './client';
import type {
  Webset,
  WebsetCreateOptions,
  WebsetListParams,
  WebsetListResponse,
  WebsetItem,
  WebsetItemsResponse,
  WebsetEnrichment,
  WebsetEnrichmentCreateOptions,
} from '../types';

/**
 * Websets API - Entity search result sets
 */
export class WebsetsApi {
  constructor(private readonly client: ExaClient) {}

  /**
   * Create a new webset
   */
  async create(options: WebsetCreateOptions): Promise<Webset> {
    const body: Record<string, unknown> = {
      searches: options.searches,
    };

    if (options.externalId) {
      body.externalId = options.externalId;
    }

    return this.client.post<Webset>('/websets', body);
  }

  /**
   * Get a webset by ID
   */
  async get(websetId: string): Promise<Webset> {
    return this.client.get<Webset>(`/websets/${websetId}`);
  }

  /**
   * List websets
   */
  async list(params: WebsetListParams = {}): Promise<WebsetListResponse> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};

    if (params.limit !== undefined) {
      queryParams.limit = params.limit;
    }
    if (params.cursor) {
      queryParams.cursor = params.cursor;
    }
    if (params.status) {
      queryParams.status = params.status;
    }

    return this.client.get<WebsetListResponse>('/websets', queryParams);
  }

  /**
   * Delete a webset
   */
  async delete(websetId: string): Promise<void> {
    await this.client.delete<void>(`/websets/${websetId}`);
  }

  /**
   * Cancel a running webset
   */
  async cancel(websetId: string): Promise<Webset> {
    return this.client.post<Webset>(`/websets/${websetId}/cancel`);
  }

  // ============================================
  // Webset Items
  // ============================================

  /**
   * List items in a webset
   */
  async listItems(
    websetId: string,
    params: { limit?: number; cursor?: string } = {}
  ): Promise<WebsetItemsResponse> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};

    if (params.limit !== undefined) {
      queryParams.limit = params.limit;
    }
    if (params.cursor) {
      queryParams.cursor = params.cursor;
    }

    return this.client.get<WebsetItemsResponse>(`/websets/${websetId}/items`, queryParams);
  }

  /**
   * Get a specific item in a webset
   */
  async getItem(websetId: string, itemId: string): Promise<WebsetItem> {
    return this.client.get<WebsetItem>(`/websets/${websetId}/items/${itemId}`);
  }

  /**
   * Get all items in a webset (handles pagination)
   */
  async getAllItems(websetId: string): Promise<WebsetItem[]> {
    const allItems: WebsetItem[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.listItems(websetId, { cursor, limit: 100 });
      allItems.push(...response.items);
      cursor = response.hasMore ? response.cursor : undefined;
    } while (cursor);

    return allItems;
  }

  // ============================================
  // Webset Enrichments
  // ============================================

  /**
   * Create an enrichment for a webset
   */
  async createEnrichment(
    websetId: string,
    options: WebsetEnrichmentCreateOptions
  ): Promise<WebsetEnrichment> {
    return this.client.post<WebsetEnrichment>(`/websets/${websetId}/enrichments`, {
      name: options.name,
      description: options.description,
      format: options.format,
    });
  }

  /**
   * List enrichments for a webset
   */
  async listEnrichments(websetId: string): Promise<WebsetEnrichment[]> {
    const response = await this.client.get<{ enrichments: WebsetEnrichment[] }>(
      `/websets/${websetId}/enrichments`
    );
    return response.enrichments;
  }

  /**
   * Get a specific enrichment
   */
  async getEnrichment(websetId: string, enrichmentId: string): Promise<WebsetEnrichment> {
    return this.client.get<WebsetEnrichment>(
      `/websets/${websetId}/enrichments/${enrichmentId}`
    );
  }

  /**
   * Delete an enrichment
   */
  async deleteEnrichment(websetId: string, enrichmentId: string): Promise<void> {
    await this.client.delete<void>(`/websets/${websetId}/enrichments/${enrichmentId}`);
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * Wait for a webset to complete
   */
  async waitForCompletion(
    websetId: string,
    options: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    } = {}
  ): Promise<Webset> {
    const { pollIntervalMs = 5000, timeoutMs = 600000 } = options;
    const startTime = Date.now();

    while (true) {
      const webset = await this.get(websetId);

      if (webset.status === 'completed' || webset.status === 'failed' || webset.status === 'canceled') {
        return webset;
      }

      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Webset ${websetId} timed out after ${timeoutMs}ms`);
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Create a webset and wait for it to complete
   */
  async createAndWait(
    options: WebsetCreateOptions,
    waitOptions: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    } = {}
  ): Promise<Webset> {
    const webset = await this.create(options);
    return this.waitForCompletion(webset.id, waitOptions);
  }

  /**
   * Create a simple webset with a single search
   */
  async createSimple(
    query: string,
    entityType: string,
    numResults?: number
  ): Promise<Webset> {
    return this.create({
      searches: [
        {
          query,
          entity: { type: entityType },
          numResults,
        },
      ],
    });
  }
}
