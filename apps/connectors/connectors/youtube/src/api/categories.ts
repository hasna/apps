import type { YouTubeClient } from './client';
import type {
  VideoCategory,
  VideoCategoryListParams,
  I18nLanguage,
  I18nRegion,
  ListResponse,
} from '../types';

export interface I18nLanguageListParams {
  part: string[];
  hl?: string;
}

export interface I18nRegionListParams {
  part: string[];
  hl?: string;
}

export class CategoriesApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * List video categories
   * Quota cost: 1 unit per request
   */
  async listVideoCategories(params: VideoCategoryListParams): Promise<ListResponse<VideoCategory>> {
    return this.client.get<ListResponse<VideoCategory>>('/videoCategories', {
      part: params.part,
      id: params.id,
      regionCode: params.regionCode,
      hl: params.hl,
    });
  }

  /**
   * Get video categories for a region
   */
  async getForRegion(
    regionCode: string,
    hl?: string,
    parts: string[] = ['snippet']
  ): Promise<ListResponse<VideoCategory>> {
    return this.listVideoCategories({
      part: parts,
      regionCode,
      hl,
    });
  }

  /**
   * Get video categories by ID
   */
  async getById(
    categoryIds: string | string[],
    hl?: string,
    parts: string[] = ['snippet']
  ): Promise<ListResponse<VideoCategory>> {
    return this.listVideoCategories({
      part: parts,
      id: categoryIds,
      hl,
    });
  }

  /**
   * List i18n languages
   * Quota cost: 1 unit per request
   */
  async listLanguages(params: I18nLanguageListParams): Promise<ListResponse<I18nLanguage>> {
    return this.client.get<ListResponse<I18nLanguage>>('/i18nLanguages', {
      part: params.part,
      hl: params.hl,
    });
  }

  /**
   * Get all supported languages
   */
  async getLanguages(hl?: string): Promise<ListResponse<I18nLanguage>> {
    return this.listLanguages({
      part: ['snippet'],
      hl,
    });
  }

  /**
   * List i18n regions
   * Quota cost: 1 unit per request
   */
  async listRegions(params: I18nRegionListParams): Promise<ListResponse<I18nRegion>> {
    return this.client.get<ListResponse<I18nRegion>>('/i18nRegions', {
      part: params.part,
      hl: params.hl,
    });
  }

  /**
   * Get all supported regions
   */
  async getRegions(hl?: string): Promise<ListResponse<I18nRegion>> {
    return this.listRegions({
      part: ['snippet'],
      hl,
    });
  }
}
