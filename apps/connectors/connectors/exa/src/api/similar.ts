import type { ExaClient } from './client';
import type { FindSimilarOptions, FindSimilarResponse, SearchCategory } from '../types';

/**
 * Similar API - Find pages similar to a given URL
 */
export class SimilarApi {
  constructor(private readonly client: ExaClient) {}

  /**
   * Find pages similar to a URL
   */
  async find(options: FindSimilarOptions): Promise<FindSimilarResponse> {
    const body: Record<string, unknown> = {
      url: options.url,
    };

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
    if (options.excludeSourceDomain !== undefined) {
      body.excludeSourceDomain = options.excludeSourceDomain;
    }
    if (options.category) {
      body.category = options.category;
    }
    if (options.contents) {
      body.contents = options.contents;
    }

    return this.client.post<FindSimilarResponse>('/findSimilar', body);
  }

  /**
   * Find similar pages with a specific limit
   */
  async findWithLimit(url: string, numResults: number): Promise<FindSimilarResponse> {
    return this.find({ url, numResults });
  }

  /**
   * Find similar pages excluding the source domain
   */
  async findExcludingSource(url: string, numResults?: number): Promise<FindSimilarResponse> {
    return this.find({ url, numResults, excludeSourceDomain: true });
  }

  /**
   * Find similar pages within specific domains
   */
  async findInDomains(
    url: string,
    includeDomains: string[],
    numResults?: number
  ): Promise<FindSimilarResponse> {
    return this.find({ url, includeDomains, numResults });
  }

  /**
   * Find similar pages excluding specific domains
   */
  async findExcludingDomains(
    url: string,
    excludeDomains: string[],
    numResults?: number
  ): Promise<FindSimilarResponse> {
    return this.find({ url, excludeDomains, numResults });
  }

  /**
   * Find similar pages in a specific category
   */
  async findInCategory(
    url: string,
    category: SearchCategory,
    numResults?: number
  ): Promise<FindSimilarResponse> {
    return this.find({ url, category, numResults });
  }

  /**
   * Find similar pages and get contents inline
   */
  async findWithContents(
    url: string,
    options: Omit<FindSimilarOptions, 'url'> = {}
  ): Promise<FindSimilarResponse> {
    const contentsOptions = options.contents || { text: true };
    return this.find({ ...options, url, contents: contentsOptions });
  }

  /**
   * Find similar pages within a date range
   */
  async findDateRange(
    url: string,
    options: {
      startCrawlDate?: string;
      endCrawlDate?: string;
      startPublishedDate?: string;
      endPublishedDate?: string;
      numResults?: number;
    }
  ): Promise<FindSimilarResponse> {
    return this.find({
      url,
      startCrawlDate: options.startCrawlDate,
      endCrawlDate: options.endCrawlDate,
      startPublishedDate: options.startPublishedDate,
      endPublishedDate: options.endPublishedDate,
      numResults: options.numResults,
    });
  }
}
