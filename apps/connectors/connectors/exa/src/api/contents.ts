import type { ExaClient } from './client';
import type { ContentsRequest, ContentsResponse, TextContentsOptions, HighlightsContentsOptions, SummaryContentsOptions } from '../types';

/**
 * Contents API - Retrieve page contents, text, highlights, and summaries
 */
export class ContentsApi {
  constructor(private readonly client: ExaClient) {}

  /**
   * Get contents for multiple URLs or IDs
   */
  async get(request: ContentsRequest): Promise<ContentsResponse> {
    const body: Record<string, unknown> = {};

    if (request.ids?.length) {
      body.ids = request.ids;
    }
    if (request.urls?.length) {
      body.urls = request.urls;
    }
    if (request.text !== undefined) {
      body.text = request.text;
    }
    if (request.highlights !== undefined) {
      body.highlights = request.highlights;
    }
    if (request.summary !== undefined) {
      body.summary = request.summary;
    }

    return this.client.post<ContentsResponse>('/contents', body);
  }

  /**
   * Get text content from URLs
   */
  async getText(
    urls: string[],
    options: TextContentsOptions = {}
  ): Promise<ContentsResponse> {
    return this.get({
      urls,
      text: Object.keys(options).length > 0 ? options : true,
    });
  }

  /**
   * Get text content from result IDs
   */
  async getTextByIds(
    ids: string[],
    options: TextContentsOptions = {}
  ): Promise<ContentsResponse> {
    return this.get({
      ids,
      text: Object.keys(options).length > 0 ? options : true,
    });
  }

  /**
   * Get highlights from URLs
   */
  async getHighlights(
    urls: string[],
    options: HighlightsContentsOptions = {}
  ): Promise<ContentsResponse> {
    return this.get({
      urls,
      highlights: Object.keys(options).length > 0 ? options : true,
    });
  }

  /**
   * Get highlights from result IDs
   */
  async getHighlightsByIds(
    ids: string[],
    options: HighlightsContentsOptions = {}
  ): Promise<ContentsResponse> {
    return this.get({
      ids,
      highlights: Object.keys(options).length > 0 ? options : true,
    });
  }

  /**
   * Get summaries from URLs
   */
  async getSummaries(
    urls: string[],
    options: SummaryContentsOptions = {}
  ): Promise<ContentsResponse> {
    return this.get({
      urls,
      summary: Object.keys(options).length > 0 ? options : true,
    });
  }

  /**
   * Get summaries from result IDs
   */
  async getSummariesByIds(
    ids: string[],
    options: SummaryContentsOptions = {}
  ): Promise<ContentsResponse> {
    return this.get({
      ids,
      summary: Object.keys(options).length > 0 ? options : true,
    });
  }

  /**
   * Get all content types (text, highlights, summary) from URLs
   */
  async getAll(
    urls: string[],
    options: {
      text?: TextContentsOptions | boolean;
      highlights?: HighlightsContentsOptions | boolean;
      summary?: SummaryContentsOptions | boolean;
    } = {}
  ): Promise<ContentsResponse> {
    return this.get({
      urls,
      text: options.text ?? true,
      highlights: options.highlights ?? true,
      summary: options.summary ?? true,
    });
  }

  /**
   * Get all content types from result IDs
   */
  async getAllByIds(
    ids: string[],
    options: {
      text?: TextContentsOptions | boolean;
      highlights?: HighlightsContentsOptions | boolean;
      summary?: SummaryContentsOptions | boolean;
    } = {}
  ): Promise<ContentsResponse> {
    return this.get({
      ids,
      text: options.text ?? true,
      highlights: options.highlights ?? true,
      summary: options.summary ?? true,
    });
  }
}
