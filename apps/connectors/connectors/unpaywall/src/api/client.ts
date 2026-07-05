import type { DoiObject, SearchOptions, SearchResult } from '../types';
import { UnpaywallApiError } from '../types';

const BASE_URL = 'https://api.unpaywall.org/v2';

export class UnpaywallClient {
  private readonly email: string;

  constructor(email: string) {
    if (!email) {
      throw new Error('Unpaywall email is required');
    }
    this.email = email;
  }

  /**
   * Normalize and encode a DOI for use in URL path segments.
   * Handles slashes in DOIs like 10.1038/nature12373.
   */
  encodeDoi(doi: string): string {
    const clean = doi
      .replace(/^https?:\/\/doi\.org\//i, '')
      .replace(/^doi:/i, '')
      .trim();
    return clean.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  }

  buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('email', this.email);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private async request<T>(url: string): Promise<T> {
    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text().catch(() => undefined);
      throw new UnpaywallApiError(
        `Unpaywall API error: ${response.statusText}`,
        response.status,
        body,
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get OA status and bibliographic info for a DOI.
   */
  async getDoi(doi: string): Promise<DoiObject> {
    const encoded = this.encodeDoi(doi);
    const url = this.buildUrl(`/${encoded}`);
    return this.request<DoiObject>(url);
  }

  /**
   * Search articles by title query.
   */
  async search(query: string, options?: Omit<SearchOptions, 'query'>): Promise<SearchResult> {
    const params: Record<string, string | number | boolean | undefined> = {
      query,
    };

    if (options?.isOa !== undefined) {
      params.is_oa = options.isOa;
    }
    if (options?.page !== undefined) {
      params.page = options.page;
    }

    const url = this.buildUrl('/search', params);
    const results = await this.request<SearchResult['results']>(url);
    return { results };
  }
}
