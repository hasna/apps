import type { ZendeskClient } from './client';
import type {
  ZendeskOrganization,
  ZendeskOrganizationResponse,
  ZendeskOrganizationsResponse,
  CreateOrganizationRequest,
  OrganizationListParams,
} from '../types';

/**
 * Zendesk Organizations API
 * @see https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/
 */
export class OrganizationsApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all organizations
   * @see https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#list-organizations
   */
  async list(params?: OrganizationListParams): Promise<ZendeskOrganization[]> {
    const response = await this.client.get<ZendeskOrganizationsResponse>('/organizations.json', {
      page: params?.page,
      per_page: params?.per_page,
    });
    return response.organizations;
  }

  /**
   * Get an organization by ID
   * @see https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#show-organization
   */
  async get(organizationId: number): Promise<ZendeskOrganization> {
    const response = await this.client.get<ZendeskOrganizationResponse>(`/organizations/${organizationId}.json`);
    return response.organization;
  }

  /**
   * Create a new organization
   * @see https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#create-organization
   */
  async create(data: CreateOrganizationRequest): Promise<ZendeskOrganization> {
    const response = await this.client.post<ZendeskOrganizationResponse>('/organizations.json', data);
    return response.organization;
  }

  /**
   * Update an organization
   * @see https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#update-organization
   */
  async update(organizationId: number, data: Partial<CreateOrganizationRequest>): Promise<ZendeskOrganization> {
    const response = await this.client.put<ZendeskOrganizationResponse>(`/organizations/${organizationId}.json`, data);
    return response.organization;
  }

  /**
   * Delete an organization
   * @see https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#delete-organization
   */
  async delete(organizationId: number): Promise<void> {
    await this.client.delete(`/organizations/${organizationId}.json`);
  }

  /**
   * Search organizations
   * @see https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#autocomplete-organizations
   */
  async search(name: string): Promise<ZendeskOrganization[]> {
    const response = await this.client.get<ZendeskOrganizationsResponse>('/organizations/autocomplete.json', {
      name,
    });
    return response.organizations;
  }

  /**
   * Get organization by external ID
   * @see https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/#show-organization
   */
  async getByExternalId(externalId: string): Promise<ZendeskOrganization[]> {
    const response = await this.client.get<ZendeskOrganizationsResponse>('/organizations/search.json', {
      external_id: externalId,
    });
    return response.organizations;
  }
}
