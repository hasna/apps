import type {
  ZeroTierConfig,
  ZeroTierStatus,
  ZeroTierOrganization,
  ZeroTierNetwork,
  ZeroTierMember,
  ZeroTierUser,
  ZeroTierOrgUser,
  ZeroTierInvite,
  ZeroTierAuditLogEntry,
  CreateNetworkOptions,
  AuthorizeMemberOptions,
  AuditLogOptions,
  OrgRole,
} from '../types';
import { ZeroTierClient } from './client';

function encodeId(id: string): string {
  return encodeURIComponent(id);
}

export class ZeroTier {
  private readonly client: ZeroTierClient;

  constructor(config: ZeroTierConfig) {
    this.client = new ZeroTierClient(config);
  }

  static fromEnv(): ZeroTier {
    const apiKey = process.env.ZEROTIER_API_KEY;
    if (!apiKey) {
      throw new Error('ZEROTIER_API_KEY environment variable is required');
    }
    return new ZeroTier({
      apiKey,
      baseUrl: process.env.ZEROTIER_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async getStatus(): Promise<ZeroTierStatus> {
    return this.client.get<ZeroTierStatus>('/api/v1/status');
  }

  async listOrganizations(): Promise<ZeroTierOrganization[]> {
    return this.client.get<ZeroTierOrganization[]>('/api/v1/org');
  }

  async listNetworks(): Promise<ZeroTierNetwork[]> {
    return this.client.get<ZeroTierNetwork[]>('/api/v1/network');
  }

  async getNetwork(id: string): Promise<ZeroTierNetwork> {
    return this.client.get<ZeroTierNetwork>(`/api/v1/network/${encodeId(id)}`);
  }

  async createNetwork(options: CreateNetworkOptions): Promise<ZeroTierNetwork> {
    return this.client.post<ZeroTierNetwork>('/api/v1/network', {
      config: {
        name: options.name,
        private: options.private,
        v4AssignMode: options.v4AssignMode,
        v6AssignMode: options.v6AssignMode,
        routes: options.routes,
        ipAssignmentPools: options.ipAssignmentPools,
        rules: options.rules,
        mtu: options.mtu,
        multicastLimit: options.multicastLimit,
        enableBroadcast: options.enableBroadcast,
      },
      description: options.description,
    });
  }

  async updateNetwork(id: string, updates: Record<string, unknown>): Promise<ZeroTierNetwork> {
    return this.client.post<ZeroTierNetwork>(`/api/v1/network/${encodeId(id)}`, updates);
  }

  async deleteNetwork(id: string): Promise<unknown> {
    return this.client.delete(`/api/v1/network/${encodeId(id)}`);
  }

  async listMembers(networkId: string): Promise<ZeroTierMember[]> {
    return this.client.get<ZeroTierMember[]>(`/api/v1/network/${encodeId(networkId)}/member`);
  }

  async getMember(networkId: string, nodeId: string): Promise<ZeroTierMember> {
    return this.client.get<ZeroTierMember>(
      `/api/v1/network/${encodeId(networkId)}/member/${encodeId(nodeId)}`
    );
  }

  async authorizeMember(
    networkId: string,
    nodeId: string,
    options: AuthorizeMemberOptions = {}
  ): Promise<ZeroTierMember> {
    return this.client.post<ZeroTierMember>(
      `/api/v1/network/${encodeId(networkId)}/member/${encodeId(nodeId)}`,
      {
        config: {
          authorized: true,
          ipAssignments: options.ipAssignments,
          tags: options.tags,
          capabilities: options.capabilities,
          noAutoAssignIps: options.noAutoAssignIps,
        },
        name: options.name,
        description: options.description,
      }
    );
  }

  async deauthorizeMember(networkId: string, nodeId: string): Promise<ZeroTierMember> {
    return this.client.post<ZeroTierMember>(
      `/api/v1/network/${encodeId(networkId)}/member/${encodeId(nodeId)}`,
      { config: { authorized: false } }
    );
  }

  async updateMember(
    networkId: string,
    nodeId: string,
    updates: Record<string, unknown>
  ): Promise<ZeroTierMember> {
    return this.client.post<ZeroTierMember>(
      `/api/v1/network/${encodeId(networkId)}/member/${encodeId(nodeId)}`,
      updates
    );
  }

  async deleteMember(networkId: string, nodeId: string): Promise<unknown> {
    return this.client.delete(`/api/v1/network/${encodeId(networkId)}/member/${encodeId(nodeId)}`);
  }

  async getMyAccount(): Promise<ZeroTierUser> {
    return this.client.get<ZeroTierUser>('/api/v1/user');
  }

  async listOrgUsers(orgId: string): Promise<ZeroTierOrgUser[]> {
    return this.client.get<ZeroTierOrgUser[]>(`/api/v1/org/${encodeId(orgId)}/user`);
  }

  async addOrgUser(orgId: string, email: string, role?: OrgRole): Promise<ZeroTierOrgUser> {
    return this.client.post<ZeroTierOrgUser>(`/api/v1/org/${encodeId(orgId)}/user`, { email, role });
  }

  async removeOrgUser(orgId: string, userId: string): Promise<unknown> {
    return this.client.delete(`/api/v1/org/${encodeId(orgId)}/user/${encodeId(userId)}`);
  }

  async listInvites(orgId: string): Promise<ZeroTierInvite[]> {
    return this.client.get<ZeroTierInvite[]>(`/api/v1/org/${encodeId(orgId)}/invite`);
  }

  async revokeInvite(orgId: string, inviteId: string): Promise<unknown> {
    return this.client.delete(`/api/v1/org/${encodeId(orgId)}/invite/${encodeId(inviteId)}`);
  }

  async listSso(orgId: string): Promise<unknown> {
    return this.client.get(`/api/v1/org/${encodeId(orgId)}/sso-config`);
  }

  async listAuditLogs(orgId: string, options: AuditLogOptions = {}): Promise<ZeroTierAuditLogEntry[]> {
    return this.client.get<ZeroTierAuditLogEntry[]>(`/api/v1/org/${encodeId(orgId)}/audit-log`, {
      from: options.from,
      to: options.to,
      limit: options.limit,
      cursor: options.cursor,
    });
  }

  getClient(): ZeroTierClient {
    return this.client;
  }
}

export { ZeroTierClient } from './client';
