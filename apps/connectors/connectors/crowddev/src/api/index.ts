// Crowd.dev Connector — Developer community analytics and engagement
import { CrowdDevClient } from './client';
import type { CrowdDevConfig, CDMember, CDMemberList, CDActivity, CDActivityList, CDOrganization } from '../types';
export { CrowdDevClient } from './client';

export class CrowdDev {
  private readonly client: CrowdDevClient;
  constructor(config: CrowdDevConfig) { this.client = new CrowdDevClient(config); }
  static fromEnv(): CrowdDev {
    const apiKey = process.env.CROWDDEV_API_KEY;
    const tenantId = process.env.CROWDDEV_TENANT_ID;
    if (!apiKey || !tenantId) throw new Error('CROWDDEV_API_KEY and CROWDDEV_TENANT_ID are required');
    return new CrowdDev({ apiKey, tenantId });
  }

  async listMembers(options?: { limit?: number; offset?: number; filter?: Record<string, unknown> }): Promise<CDMemberList> {
    return this.client.request<CDMemberList>('/member', { method: 'POST', body: { limit: options?.limit, offset: options?.offset, filter: options?.filter } as Record<string, unknown> });
  }
  async getMember(memberId: string): Promise<CDMember> { return this.client.request<CDMember>(`/member/${memberId}`); }

  async listActivities(options?: { limit?: number; offset?: number; filter?: Record<string, unknown> }): Promise<CDActivityList> {
    return this.client.request<CDActivityList>('/activity', { method: 'POST', body: { limit: options?.limit, offset: options?.offset, filter: options?.filter } as Record<string, unknown> });
  }

  async listOrganizations(options?: { limit?: number; offset?: number }): Promise<{ rows: CDOrganization[]; count: number }> {
    return this.client.request('/organization', { method: 'POST', body: { limit: options?.limit, offset: options?.offset } as Record<string, unknown> });
  }
  async getOrganization(orgId: string): Promise<CDOrganization> { return this.client.request<CDOrganization>(`/organization/${orgId}`); }

  getClient(): CrowdDevClient { return this.client; }
}
