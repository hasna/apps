import { NotionClient } from './client';
import type {
  PaginatedResponse,
  SearchOptions,
  SearchResult,
  NotionPage,
  NotionDatabase,
} from '../types';

export class SearchApi {
  constructor(private readonly client: NotionClient) {}

  /**
   * Search pages and databases
   * https://developers.notion.com/reference/post-search
   */
  async search(options: SearchOptions = {}): Promise<PaginatedResponse<SearchResult>> {
    const body: Record<string, unknown> = {};

    if (options.query) {
      body.query = options.query;
    }
    if (options.filter) {
      body.filter = options.filter;
    }
    if (options.sort) {
      body.sort = options.sort;
    }
    if (options.start_cursor) {
      body.start_cursor = options.start_cursor;
    }
    if (options.page_size) {
      body.page_size = options.page_size;
    }

    return this.client.post<PaginatedResponse<SearchResult>>('/search', body);
  }

  /**
   * Search with a query string
   */
  async query(
    query: string,
    startCursor?: string,
    pageSize: number = 100
  ): Promise<PaginatedResponse<SearchResult>> {
    return this.search({
      query,
      start_cursor: startCursor,
      page_size: pageSize,
    });
  }

  /**
   * Search only pages
   */
  async pages(
    query?: string,
    startCursor?: string,
    pageSize: number = 100
  ): Promise<PaginatedResponse<NotionPage>> {
    return this.search({
      query,
      filter: {
        value: 'page',
        property: 'object',
      },
      start_cursor: startCursor,
      page_size: pageSize,
    }) as Promise<PaginatedResponse<NotionPage>>;
  }

  /**
   * Search only databases
   */
  async databases(
    query?: string,
    startCursor?: string,
    pageSize: number = 100
  ): Promise<PaginatedResponse<NotionDatabase>> {
    return this.search({
      query,
      filter: {
        value: 'database',
        property: 'object',
      },
      start_cursor: startCursor,
      page_size: pageSize,
    }) as Promise<PaginatedResponse<NotionDatabase>>;
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Search all results (handles pagination)
   */
  async searchAll(options: Omit<SearchOptions, 'start_cursor' | 'page_size'> = {}): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.search({
        ...options,
        start_cursor: cursor,
        page_size: 100,
      });

      allResults.push(...response.results);
      cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (cursor);

    return allResults;
  }

  /**
   * Search all pages (handles pagination)
   */
  async searchAllPages(query?: string): Promise<NotionPage[]> {
    const results = await this.searchAll({
      query,
      filter: {
        value: 'page',
        property: 'object',
      },
    });
    return results as NotionPage[];
  }

  /**
   * Search all databases (handles pagination)
   */
  async searchAllDatabases(query?: string): Promise<NotionDatabase[]> {
    const results = await this.searchAll({
      query,
      filter: {
        value: 'database',
        property: 'object',
      },
    });
    return results as NotionDatabase[];
  }

  /**
   * Search with sorting by last edited time
   */
  async searchRecent(
    query?: string,
    direction: 'ascending' | 'descending' = 'descending',
    pageSize: number = 100
  ): Promise<PaginatedResponse<SearchResult>> {
    return this.search({
      query,
      sort: {
        direction,
        timestamp: 'last_edited_time',
      },
      page_size: pageSize,
    });
  }

  /**
   * Get recently edited pages
   */
  async recentPages(
    limit: number = 10
  ): Promise<NotionPage[]> {
    const response = await this.search({
      filter: {
        value: 'page',
        property: 'object',
      },
      sort: {
        direction: 'descending',
        timestamp: 'last_edited_time',
      },
      page_size: limit,
    });
    return response.results as NotionPage[];
  }

  /**
   * Get recently edited databases
   */
  async recentDatabases(
    limit: number = 10
  ): Promise<NotionDatabase[]> {
    const response = await this.search({
      filter: {
        value: 'database',
        property: 'object',
      },
      sort: {
        direction: 'descending',
        timestamp: 'last_edited_time',
      },
      page_size: limit,
    });
    return response.results as NotionDatabase[];
  }
}
