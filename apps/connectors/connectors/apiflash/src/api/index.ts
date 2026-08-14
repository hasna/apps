// ApiFlash Connector — Website screenshot API
import { ApiFlashClient } from './client';
import type { ApiFlashConfig, ApiFlashOptions, ApiFlashScreenshot, ApiFlashQuota } from '../types';
export { ApiFlashClient } from './client';

export class ApiFlash {
  private readonly client: ApiFlashClient;
  constructor(config: ApiFlashConfig) { this.client = new ApiFlashClient(config); }
  static fromEnv(): ApiFlash {
    const accessKey = process.env.APIFLASH_ACCESS_KEY;
    if (!accessKey) throw new Error('APIFLASH_ACCESS_KEY is required');
    return new ApiFlash({ accessKey });
  }

  async screenshot(options: ApiFlashOptions): Promise<ApiFlashScreenshot> {
    const params: Record<string, string | number | boolean | undefined> = {
      url: options.url,
      format: options.format,
      width: options.width,
      height: options.height,
      full_page: options.full_page,
      fresh: options.fresh,
      quality: options.quality,
      delay: options.delay,
      scroll_page: options.scroll_page,
      css: options.css,
      js: options.js,
      wait_until: options.wait_until,
      response_type: options.response_type || 'json',
      thumbnail_width: options.thumbnail_width,
      no_cookie_banners: options.no_cookie_banners,
      no_ads: options.no_ads,
      no_tracking: options.no_tracking,
      element: options.element,
      transparent: options.transparent,
    };
    return this.client.request<ApiFlashScreenshot>('/urltoimage', params);
  }

  async getQuota(): Promise<ApiFlashQuota> {
    return this.client.request<ApiFlashQuota>('/urltoimage/quota');
  }

  screenshotUrl(options: ApiFlashOptions): string {
    const url = new URL('https://api.apiflash.com/v1/urltoimage');
    url.searchParams.append('access_key', this.client.getAccessKey());
    url.searchParams.append('url', options.url);
    if (options.format) url.searchParams.append('format', options.format);
    if (options.width) url.searchParams.append('width', String(options.width));
    if (options.height) url.searchParams.append('height', String(options.height));
    if (options.full_page) url.searchParams.append('full_page', 'true');
    return url.toString();
  }

  getClient(): ApiFlashClient { return this.client; }
}
