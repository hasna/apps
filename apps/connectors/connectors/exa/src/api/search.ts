import type { ExaClient } from './client';
import type { SearchOptions, SearchResponse, SearchCategory } from '../types';

/**
 * Search API - Web search with neural, keyword, or auto modes
 */
export class SearchApi {
  constructor(private readonly client: ExaClient) {}

  /**
   * Perform a web search
   * Supports neural (semantic), keyword, or auto (hybrid) search modes
   */
  async search(options: SearchOptions): Promise<SearchResponse> {
    const body: Record<string, unknown> = {
      query: options.query,
    };

    if (options.useAutoprompt !== undefined) {
      body.useAutoprompt = options.useAutoprompt;
    }
    if (options.type) {
      body.type = options.type;
    }
    if (options.category) {
      body.category = options.category;
    }
    if (options.numResults !== undefined) {
      body.numResults = options.numResults;
    }
    if (options.includeDomains?.length) {
      body.includeDomains = options.includeDomains;
    }
    if (options.excludeDomains?.length) {
      body.excludeDomains = options.excludeDomains;
    }
    if (options.startCrawlDate) {
      body.startCrawlDate = options.startCrawlDate;
    }
    if (options.endCrawlDate) {
      body.endCrawlDate = options.endCrawlDate;
    }
    if (options.startPublishedDate) {
      body.startPublishedDate = options.startPublishedDate;
    }
    if (options.endPublishedDate) {
      body.endPublishedDate = options.endPublishedDate;
    }
    if (options.includeText?.length) {
      body.includeText = options.includeText;
    }
    if (options.excludeText?.length) {
      body.excludeText = options.excludeText;
    }
    if (options.contents) {
      body.contents = options.contents;
    }

    return this.client.post<SearchResponse>('/search', body);
  }

  /**
   * Neural search (semantic/AI-powered)
   */
  async neural(query: string, options: Omit<SearchOptions, 'query' | 'type'> = {}): Promise<SearchResponse> {
    return this.search({ ...options, query, type: 'neural' });
  }

  /**
   * Keyword search (traditional)
   */
  async keyword(query: string, options: Omit<SearchOptions, 'query' | 'type'> = {}): Promise<SearchResponse> {
    return this.search({ ...options, query, type: 'keyword' });
  }

  /**
   * Auto search (hybrid - lets Exa decide)
   */
  async auto(query: string, options: Omit<SearchOptions, 'query' | 'type'> = {}): Promise<SearchResponse> {
    return this.search({ ...options, query, type: 'auto' });
  }

  /**
   * Search with autoprompt enabled (Exa will optimize the query)
   */
  async searchWithAutoprompt(query: string, options: Omit<SearchOptions, 'query' | 'useAutoprompt'> = {}): Promise<SearchResponse> {
    return this.search({ ...options, query, useAutoprompt: true });
  }

  /**
   * Search within a specific category
   */
  async searchCategory(
    query: string,
    category: SearchCategory,
    options: Omit<SearchOptions, 'query' | 'category'> = {}
  ): Promise<SearchResponse> {
    return this.search({ ...options, query, category });
  }

  /**
   * Search and get contents inline
   */
  async searchAndContents(
    query: string,
    options: Omit<SearchOptions, 'query'> = {}
  ): Promise<SearchResponse> {
    const contentsOptions = options.contents || { text: true };
    return this.search({ ...options, query, contents: contentsOptions });
  }

  /**
   * Search with domain filtering
   */
  async searchDomains(
    query: string,
    options: {
      includeDomains?: string[];
      excludeDomains?: string[];
      numResults?: number;
    } = {}
  ): Promise<SearchResponse> {
    return this.search({
      query,
      includeDomains: options.includeDomains,
      excludeDomains: options.excludeDomains,
      numResults: options.numResults,
    });
  }

  /**
   * Search with date filtering
   */
  async searchDateRange(
    query: string,
    options: {
      startCrawlDate?: string;
      endCrawlDate?: string;
      startPublishedDate?: string;
      endPublishedDate?: string;
      numResults?: number;
    } = {}
  ): Promise<SearchResponse> {
    return this.search({
      query,
      startCrawlDate: options.startCrawlDate,
      endCrawlDate: options.endCrawlDate,
      startPublishedDate: options.startPublishedDate,
      endPublishedDate: options.endPublishedDate,
      numResults: options.numResults,
    });
  }
}
