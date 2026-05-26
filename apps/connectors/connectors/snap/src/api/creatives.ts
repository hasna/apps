import type { SnapClient } from './client';
import type {
  Creative,
  CreativeCreateParams,
  CreativeUpdateParams,
  CreativeResponse,
} from '../types';

/**
 * Snapchat Creatives API
 * Manage ad creatives (SNAP_AD, APP_INSTALL, WEB_VIEW, etc.)
 */
export class CreativesApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * List all creatives for an ad account
   */
  async list(adAccountId: string): Promise<Creative[]> {
    const response = await this.client.get<CreativeResponse>(
      `/adaccounts/${adAccountId}/creatives`
    );
    return response.creatives?.map(c => c.creative) || [];
  }

  /**
   * Get a specific creative by ID
   */
  async get(creativeId: string): Promise<Creative> {
    const response = await this.client.get<CreativeResponse>(`/creatives/${creativeId}`);
    const creative = response.creatives?.[0]?.creative;
    if (!creative) {
      throw new Error(`Creative ${creativeId} not found`);
    }
    return creative;
  }

  /**
   * Create a new creative
   */
  async create(params: CreativeCreateParams): Promise<Creative> {
    const response = await this.client.post<CreativeResponse>(
      `/adaccounts/${params.ad_account_id}/creatives`,
      {
        creatives: [params],
      }
    );
    const creative = response.creatives?.[0]?.creative;
    if (!creative) {
      throw new Error('Failed to create creative');
    }
    return creative;
  }

  /**
   * Update a creative
   */
  async update(creativeId: string, params: CreativeUpdateParams): Promise<Creative> {
    const response = await this.client.put<CreativeResponse>(
      `/creatives/${creativeId}`,
      {
        creatives: [{ id: creativeId, ...params }],
      }
    );
    const creative = response.creatives?.[0]?.creative;
    if (!creative) {
      throw new Error('Failed to update creative');
    }
    return creative;
  }

  /**
   * Delete a creative
   */
  async delete(creativeId: string): Promise<void> {
    await this.client.delete(`/creatives/${creativeId}`);
  }

  /**
   * Create a Snap Ad creative
   */
  async createSnapAd(
    adAccountId: string,
    name: string,
    topSnapMediaId: string,
    options?: {
      headline?: string;
      brandName?: string;
      callToAction?: string;
      shareable?: boolean;
    }
  ): Promise<Creative> {
    return this.create({
      name,
      ad_account_id: adAccountId,
      type: 'SNAP_AD',
      top_snap_media_id: topSnapMediaId,
      headline: options?.headline,
      brand_name: options?.brandName,
      call_to_action: options?.callToAction as Creative['call_to_action'],
      shareable: options?.shareable,
    });
  }

  /**
   * Create a Web View creative
   */
  async createWebView(
    adAccountId: string,
    name: string,
    topSnapMediaId: string,
    url: string,
    options?: {
      headline?: string;
      brandName?: string;
      callToAction?: string;
      allowSnapJavascriptSdk?: boolean;
    }
  ): Promise<Creative> {
    return this.create({
      name,
      ad_account_id: adAccountId,
      type: 'WEB_VIEW',
      top_snap_media_id: topSnapMediaId,
      headline: options?.headline,
      brand_name: options?.brandName,
      call_to_action: options?.callToAction as Creative['call_to_action'],
      web_view_properties: {
        url,
        allow_snap_javascript_sdk: options?.allowSnapJavascriptSdk,
      },
    });
  }

  /**
   * Create an App Install creative
   */
  async createAppInstall(
    adAccountId: string,
    name: string,
    topSnapMediaId: string,
    options: {
      iosAppId?: string;
      androidAppUrl?: string;
      appName?: string;
      iconMediaId?: string;
      headline?: string;
      brandName?: string;
      callToAction?: string;
    }
  ): Promise<Creative> {
    return this.create({
      name,
      ad_account_id: adAccountId,
      type: 'APP_INSTALL',
      top_snap_media_id: topSnapMediaId,
      headline: options.headline,
      brand_name: options.brandName,
      call_to_action: options.callToAction as Creative['call_to_action'],
      app_install_properties: {
        ios_app_id: options.iosAppId,
        android_app_url: options.androidAppUrl,
        app_name: options.appName,
        icon_media_id: options.iconMediaId,
      },
    });
  }

  /**
   * Create a Deep Link creative
   */
  async createDeepLink(
    adAccountId: string,
    name: string,
    topSnapMediaId: string,
    deepLinkUri: string,
    options?: {
      iosAppId?: string;
      androidAppUrl?: string;
      appName?: string;
      iconMediaId?: string;
      headline?: string;
      brandName?: string;
      callToAction?: string;
    }
  ): Promise<Creative> {
    return this.create({
      name,
      ad_account_id: adAccountId,
      type: 'DEEP_LINK',
      top_snap_media_id: topSnapMediaId,
      headline: options?.headline,
      brand_name: options?.brandName,
      call_to_action: options?.callToAction as Creative['call_to_action'],
      deep_link_properties: {
        deep_link_uri: deepLinkUri,
        ios_app_id: options?.iosAppId,
        android_app_url: options?.androidAppUrl,
        app_name: options?.appName,
        icon_media_id: options?.iconMediaId,
      },
    });
  }

  /**
   * Create an Ad to Lens creative
   */
  async createAdToLens(
    adAccountId: string,
    name: string,
    topSnapMediaId: string,
    lensMediaId: string,
    options?: {
      headline?: string;
      brandName?: string;
      callToAction?: string;
    }
  ): Promise<Creative> {
    return this.create({
      name,
      ad_account_id: adAccountId,
      type: 'AD_TO_LENS',
      top_snap_media_id: topSnapMediaId,
      headline: options?.headline,
      brand_name: options?.brandName,
      call_to_action: options?.callToAction as Creative['call_to_action'],
      ad_to_lens_properties: {
        lens_media_id: lensMediaId,
      },
    });
  }
}
