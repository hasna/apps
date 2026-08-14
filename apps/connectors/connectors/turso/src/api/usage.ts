import type { TursoClient } from './client';
import type { OrganizationUsageResponse } from '../types';

export class UsageApi {
  constructor(private readonly client: TursoClient) {}

  getOrganizationUsage(): Promise<OrganizationUsageResponse> {
    return this.client.get<OrganizationUsageResponse>(this.client.orgPath('/usage'));
  }
}
