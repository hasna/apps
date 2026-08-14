import type { WebflowClient } from './client';
import type { Page } from '../types';

export interface ListPagesOptions {
  offset?: number;
  limit?: number;
  localeId?: string;
}

/**
 * Webflow Pages API
 */
export class PagesApi {
  constructor(private readonly client: WebflowClient) {}

  /**
   * List all pages for a site
   */
  async list(siteId: string, options: ListPagesOptions = {}): Promise<{ pages: Page[]; pagination: { offset: number; limit: number; total: number } }> {
    const params: Record<string, string | number | boolean | undefined> = {
      offset: options.offset || 0,
      limit: options.limit || 100,
    };

    if (options.localeId) params.localeId = options.localeId;

    return this.client.request<{ pages: Page[]; pagination: { offset: number; limit: number; total: number } }>(
      `/sites/${siteId}/pages`,
      { params }
    );
  }

  /**
   * Get a single page by ID
   */
  async get(pageId: string, localeId?: string): Promise<Page> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (localeId) params.localeId = localeId;

    return this.client.request<Page>(
      `/pages/${pageId}`,
      { params }
    );
  }

  /**
   * Get page content (DOM structure)
   */
  async getContent(pageId: string, localeId?: string): Promise<{ pageId: string; nodes: unknown[] }> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (localeId) params.localeId = localeId;

    return this.client.request<{ pageId: string; nodes: unknown[] }>(
      `/pages/${pageId}/dom`,
      { params }
    );
  }

  /**
   * Update page settings
   */
  async update(pageId: string, updates: {
    title?: string;
    slug?: string;
    seo?: { title?: string; description?: string };
    openGraph?: { title?: string; description?: string };
  }, localeId?: string): Promise<Page> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (localeId) params.localeId = localeId;

    return this.client.request<Page>(
      `/pages/${pageId}`,
      { method: 'PATCH', body: updates, params }
    );
  }
}
