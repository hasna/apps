import type { SmartRecruitersClient } from './client';
import type { ConfigurationItem, SmartRecruitersListResponse } from '../types';

/**
 * SmartRecruiters Configuration API (`/configuration/*`).
 * Read the reference data (departments, locations, functions, industries)
 * used when creating jobs and candidates.
 */
export class ConfigurationApi {
  constructor(private readonly client: SmartRecruitersClient) {}

  /** List configured departments. */
  async departments(): Promise<SmartRecruitersListResponse<ConfigurationItem>> {
    return this.client.get<SmartRecruitersListResponse<ConfigurationItem>>('/configuration/departments');
  }

  /** List configured locations. */
  async locations(): Promise<SmartRecruitersListResponse<ConfigurationItem>> {
    return this.client.get<SmartRecruitersListResponse<ConfigurationItem>>('/configuration/locations');
  }

  /** List job functions. */
  async functions(): Promise<SmartRecruitersListResponse<ConfigurationItem>> {
    return this.client.get<SmartRecruitersListResponse<ConfigurationItem>>('/configuration/functions');
  }

  /** List industries. */
  async industries(): Promise<SmartRecruitersListResponse<ConfigurationItem>> {
    return this.client.get<SmartRecruitersListResponse<ConfigurationItem>>('/configuration/industries');
  }
}
