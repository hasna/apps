import { ClickBankClient } from './client';
import type { ImageData, ImagesListParams, ImageType } from '../types';

interface ImagesResponse {
  imageData?: ImageData[];
  _hasMore?: boolean;
}

export class ImagesApi {
  constructor(private readonly client: ClickBankClient) {}

  /**
   * Get the XML schema for image data results
   */
  async getSchema(): Promise<string> {
    return this.client.get<string>('/images/schema', undefined, 'xml');
  }

  /**
   * List images associated with an account
   */
  async list(params: ImagesListParams): Promise<{ images: ImageData[]; hasMore: boolean }> {
    const { page, ...queryParams } = params;
    const headers = page ? { page: String(page) } : undefined;

    const response = await this.client.request<ImagesResponse>('/images/list', {
      method: 'GET',
      params: queryParams as Record<string, string | number | boolean | undefined>,
      headers,
    });

    return {
      images: response.imageData || [],
      hasMore: !!response._hasMore,
    };
  }

  /**
   * Get all images for an account (handles pagination)
   */
  async getAll(site: string, approvedOnly?: boolean, type?: ImageType): Promise<ImageData[]> {
    const result: ImageData[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.list({ site, approvedOnly, type, page });
      result.push(...response.images);
      hasMore = response.hasMore;
      page++;
    }

    return result;
  }

  /**
   * Get only approved images for an account
   */
  async getApproved(site: string, type?: ImageType): Promise<{ images: ImageData[]; hasMore: boolean }> {
    return this.list({ site, approvedOnly: true, type });
  }

  /**
   * Get product images for an account
   */
  async getProductImages(site: string, approvedOnly?: boolean): Promise<{ images: ImageData[]; hasMore: boolean }> {
    return this.list({ site, approvedOnly, type: 'PRODUCT' });
  }

  /**
   * Get banner images for an account
   */
  async getBannerImages(site: string, approvedOnly?: boolean): Promise<{ images: ImageData[]; hasMore: boolean }> {
    return this.list({ site, approvedOnly, type: 'BANNER' });
  }

  /**
   * Get custom banner images for an account
   */
  async getCustomBannerImages(site: string, approvedOnly?: boolean): Promise<{ images: ImageData[]; hasMore: boolean }> {
    return this.list({ site, approvedOnly, type: 'CUSTOM_BANNER' });
  }

  /**
   * Get custom orderform images for an account
   */
  async getOrderformImages(site: string, approvedOnly?: boolean): Promise<{ images: ImageData[]; hasMore: boolean }> {
    return this.list({ site, approvedOnly, type: 'CUSTOM_ORDERFORM' });
  }
}
