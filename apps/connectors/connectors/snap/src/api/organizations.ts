import type { SnapClient } from './client';
import type { Organization, OrganizationResponse } from '../types';

/**
 * Snapchat Organizations API
 * Manage organizations (business entities)
 */
export class OrganizationsApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * Get all organizations the authenticated user has access to
   */
  async list(): Promise<Organization[]> {
    const response = await this.client.get<OrganizationResponse>('/me/organizations');
    return response.organizations?.map(o => o.organization) || [];
  }

  /**
   * Get a specific organization by ID
   */
  async get(organizationId: string): Promise<Organization> {
    const response = await this.client.get<OrganizationResponse>(`/organizations/${organizationId}`);
    const org = response.organizations?.[0]?.organization;
    if (!org) {
      throw new Error(`Organization ${organizationId} not found`);
    }
    return org;
  }
}
