import type { SnapClient } from './client';
import type {
  Pixel,
  PixelCreateParams,
  PixelUpdateParams,
  PixelResponse,
} from '../types';

/**
 * Snapchat Pixels API
 * Manage Snap Pixel for conversion tracking
 */
export class PixelsApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * List all pixels for an ad account
   */
  async list(adAccountId: string): Promise<Pixel[]> {
    const response = await this.client.get<PixelResponse>(
      `/adaccounts/${adAccountId}/pixels`
    );
    return response.pixels?.map(p => p.pixel) || [];
  }

  /**
   * Get a specific pixel by ID
   */
  async get(pixelId: string): Promise<Pixel> {
    const response = await this.client.get<PixelResponse>(`/pixels/${pixelId}`);
    const pixel = response.pixels?.[0]?.pixel;
    if (!pixel) {
      throw new Error(`Pixel ${pixelId} not found`);
    }
    return pixel;
  }

  /**
   * Create a new pixel
   */
  async create(params: PixelCreateParams): Promise<Pixel> {
    const response = await this.client.post<PixelResponse>(
      `/adaccounts/${params.ad_account_id}/pixels`,
      {
        pixels: [params],
      }
    );
    const pixel = response.pixels?.[0]?.pixel;
    if (!pixel) {
      throw new Error('Failed to create pixel');
    }
    return pixel;
  }

  /**
   * Update a pixel
   */
  async update(pixelId: string, params: PixelUpdateParams): Promise<Pixel> {
    const response = await this.client.put<PixelResponse>(
      `/pixels/${pixelId}`,
      {
        pixels: [{ id: pixelId, ...params }],
      }
    );
    const pixel = response.pixels?.[0]?.pixel;
    if (!pixel) {
      throw new Error('Failed to update pixel');
    }
    return pixel;
  }

  /**
   * Delete a pixel
   */
  async delete(pixelId: string): Promise<void> {
    await this.client.delete(`/pixels/${pixelId}`);
  }

  /**
   * Pause a pixel
   */
  async pause(pixelId: string): Promise<Pixel> {
    return this.update(pixelId, { status: 'PAUSED' });
  }

  /**
   * Activate a pixel
   */
  async activate(pixelId: string): Promise<Pixel> {
    return this.update(pixelId, { status: 'ACTIVE' });
  }

  /**
   * Get pixel JavaScript code
   */
  async getCode(pixelId: string): Promise<string> {
    const pixel = await this.get(pixelId);
    return pixel.pixel_javascript || '';
  }

  /**
   * Get pixel domains (allowed domains for the pixel)
   */
  async getDomains(pixelId: string): Promise<string[]> {
    const response = await this.client.get<{
      request_status: string;
      domains: { domain: string }[];
    }>(`/pixels/${pixelId}/domains`);
    return response.domains?.map(d => d.domain) || [];
  }

  /**
   * Add a domain to a pixel
   */
  async addDomain(pixelId: string, domain: string): Promise<void> {
    await this.client.post(`/pixels/${pixelId}/domains`, {
      domains: [{ domain }],
    });
  }

  /**
   * Remove a domain from a pixel
   */
  async removeDomain(pixelId: string, domainId: string): Promise<void> {
    await this.client.delete(`/pixels/${pixelId}/domains/${domainId}`);
  }

  /**
   * Generate pixel base code for a website
   */
  generateBaseCode(pixelId: string): string {
    return `<!-- Snap Pixel Code -->
<script type='text/javascript'>
(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function()
{a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};
a.queue=[];var s='script';r=t.createElement(s);r.async=!0;
r.src=n;var u=t.getElementsByTagName(s)[0];
u.parentNode.insertBefore(r,u);})(window,document,
'https://sc-static.net/scevent.min.js');

snaptr('init', '${pixelId}');
snaptr('track', 'PAGE_VIEW');
</script>
<!-- End Snap Pixel Code -->`;
  }

  /**
   * Generate event tracking code
   */
  generateEventCode(
    eventType: string,
    options?: {
      price?: number;
      currency?: string;
      itemIds?: string[];
      numberOfItems?: number;
      transactionId?: string;
      description?: string;
    }
  ): string {
    const params: Record<string, unknown> = {};

    if (options?.price) params.price = options.price;
    if (options?.currency) params.currency = options.currency;
    if (options?.itemIds) params.item_ids = options.itemIds;
    if (options?.numberOfItems) params.number_items = options.numberOfItems;
    if (options?.transactionId) params.transaction_id = options.transactionId;
    if (options?.description) params.description = options.description;

    const paramsStr = Object.keys(params).length > 0
      ? `, ${JSON.stringify(params)}`
      : '';

    return `snaptr('track', '${eventType}'${paramsStr});`;
  }

  /**
   * List supported pixel event types
   */
  getSupportedEventTypes(): string[] {
    return [
      'PAGE_VIEW',
      'VIEW_CONTENT',
      'ADD_CART',
      'ADD_TO_WISHLIST',
      'SIGN_UP',
      'PURCHASE',
      'SAVE',
      'START_CHECKOUT',
      'ADD_BILLING',
      'SEARCH',
      'SUBSCRIBE',
      'AD_CLICK',
      'AD_VIEW',
      'COMPLETE_TUTORIAL',
      'LEVEL_COMPLETE',
      'INVITE',
      'LOGIN',
      'SHARE',
      'RESERVE',
      'ACHIEVEMENT_UNLOCKED',
      'SPENT_CREDITS',
      'RATE',
      'START_TRIAL',
      'LIST_VIEW',
      'APP_OPEN',
      'APP_INSTALL',
      'CUSTOM_EVENT_1',
      'CUSTOM_EVENT_2',
      'CUSTOM_EVENT_3',
      'CUSTOM_EVENT_4',
      'CUSTOM_EVENT_5',
    ];
  }
}
