import type { ZendeskClient } from './client';
import type {
  ZendeskBrand,
  ZendeskBrandResponse,
  ZendeskBrandsResponse,
  CreateBrandRequest,
  UpdateBrandRequest,
  BrandListParams,
} from '../types';

/**
 * Zendesk Brands API
 * @see https://developer.zendesk.com/api-reference/ticketing/account-configuration/brands/
 */
export class BrandsApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all brands
   * @see https://developer.zendesk.com/api-reference/ticketing/account-configuration/brands/#list-brands
   */
  async list(params?: BrandListParams): Promise<ZendeskBrand[]> {
    const response = await this.client.get<ZendeskBrandsResponse>('/brands.json', {
      page: params?.page,
      per_page: params?.per_page,
    });
    return response.brands;
  }

  /**
   * Get a brand by ID
   * @see https://developer.zendesk.com/api-reference/ticketing/account-configuration/brands/#show-brand
   */
  async get(brandId: number): Promise<ZendeskBrand> {
    const response = await this.client.get<ZendeskBrandResponse>(`/brands/${brandId}.json`);
    return response.brand;
  }

  /**
   * Create a new brand
   * @see https://developer.zendesk.com/api-reference/ticketing/account-configuration/brands/#create-brand
   */
  async create(data: CreateBrandRequest): Promise<ZendeskBrand> {
    const response = await this.client.post<ZendeskBrandResponse>('/brands.json', data);
    return response.brand;
  }

  /**
   * Update a brand
   * @see https://developer.zendesk.com/api-reference/ticketing/account-configuration/brands/#update-brand
   */
  async update(brandId: number, data: UpdateBrandRequest): Promise<ZendeskBrand> {
    const response = await this.client.put<ZendeskBrandResponse>(`/brands/${brandId}.json`, data);
    return response.brand;
  }

  /**
   * Delete a brand
   * @see https://developer.zendesk.com/api-reference/ticketing/account-configuration/brands/#delete-brand
   */
  async delete(brandId: number): Promise<void> {
    await this.client.delete(`/brands/${brandId}.json`);
  }

  /**
   * Check host mapping validity
   * @see https://developer.zendesk.com/api-reference/ticketing/account-configuration/brands/#check-host-mapping-validity-for-an-existing-brand
   */
  async checkHostMapping(brandId: number): Promise<{ is_valid: boolean; reason: string | null }> {
    return this.client.get(`/brands/${brandId}/check_host_mapping.json`);
  }

  /**
   * Check host mapping validity (before creating)
   * @see https://developer.zendesk.com/api-reference/ticketing/account-configuration/brands/#check-host-mapping-validity
   */
  async checkHostMappingForHost(hostMapping: string, subdomain: string): Promise<{ is_valid: boolean; reason: string | null }> {
    return this.client.get('/brands/check_host_mapping.json', { host_mapping: hostMapping, subdomain });
  }
}
