import { TeleportClient } from './client';
import type {
  TeleportAccessRequest,
  TeleportAuthConnector,
  TeleportConfig,
  TeleportResourceId,
  TeleportRole,
  TeleportUser,
} from '../types';

export { TeleportClient } from './client';

function requireString(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`Teleport: ${label} is required`);
  return value.trim();
}

export class Teleport {
  private readonly client: TeleportClient;

  constructor(config: TeleportConfig) {
    this.client = new TeleportClient(config);
  }

  static fromEnv(): Teleport {
    const baseUrl = process.env.TELEPORT_BASE_URL;
    const token = process.env.TELEPORT_TOKEN;
    if (!baseUrl || !token) throw new Error('TELEPORT_BASE_URL and TELEPORT_TOKEN are required');
    return new Teleport({ baseUrl, token });
  }

  async getPing(): Promise<unknown> {
    return this.client.request('/v1/webapi/ping');
  }

  async listNodes(options: { searchAsRoles?: boolean; query?: string; pageSize?: number; startKey?: string } = {}): Promise<unknown> {
    return this.client.request('/v1/sites/local/nodes', {
      query: {
        query: options.query,
        page_size: options.pageSize,
        start_key: options.startKey,
        search_as_roles: options.searchAsRoles,
      },
    });
  }

  async getNode(name: string): Promise<unknown> {
    return this.client.request(`/v1/sites/local/nodes/${encodeURIComponent(requireString(name, 'name'))}`);
  }

  async listApps(): Promise<unknown> {
    return this.client.request('/v1/sites/local/apps');
  }

  async listKubernetesClusters(): Promise<unknown> {
    return this.client.request('/v1/sites/local/kubernetes');
  }

  async listDatabases(): Promise<unknown> {
    return this.client.request('/v1/sites/local/databases');
  }

  async listDesktops(): Promise<unknown> {
    return this.client.request('/v1/sites/local/desktops');
  }

  async listSessions(options: { from?: string; to?: string; order?: 'ASC' | 'DESC'; pageSize?: number; startKey?: string } = {}): Promise<unknown> {
    return this.client.request('/v1/sites/local/sessions', {
      query: {
        from: options.from,
        to: options.to,
        order: options.order,
        page_size: options.pageSize,
        start_key: options.startKey,
      },
    });
  }

  async getSession(id: string): Promise<unknown> {
    return this.client.request(`/v1/sites/local/sessions/${encodeURIComponent(requireString(id, 'id'))}`);
  }

  async terminateSession(id: string, participantId?: string): Promise<unknown> {
    return this.client.request(`/v1/sites/local/sessions/${encodeURIComponent(requireString(id, 'id'))}`, {
      method: 'DELETE',
      query: { participant_id: participantId },
    });
  }

  async listUsers(): Promise<unknown> {
    return this.client.request('/v1/users');
  }

  async getUser(name: string, withSecrets?: boolean): Promise<unknown> {
    return this.client.request(`/v1/users/${encodeURIComponent(requireString(name, 'name'))}`, {
      query: { with_secrets: withSecrets },
    });
  }

  async createUser(user: TeleportUser): Promise<unknown> {
    return this.client.request('/v1/users', { method: 'POST', body: user });
  }

  async updateUser(name: string, user: Record<string, unknown>): Promise<unknown> {
    return this.client.request(`/v1/users/${encodeURIComponent(requireString(name, 'name'))}`, {
      method: 'PUT',
      body: user,
    });
  }

  async deleteUser(name: string): Promise<unknown> {
    return this.client.request(`/v1/users/${encodeURIComponent(requireString(name, 'name'))}`, { method: 'DELETE' });
  }

  async listRoles(): Promise<unknown> {
    return this.client.request('/v1/roles');
  }

  async getRole(name: string): Promise<unknown> {
    return this.client.request(`/v1/roles/${encodeURIComponent(requireString(name, 'name'))}`);
  }

  async upsertRole(role: TeleportRole): Promise<unknown> {
    return this.client.request('/v1/roles', { method: 'POST', body: role });
  }

  async deleteRole(name: string): Promise<unknown> {
    return this.client.request(`/v1/roles/${encodeURIComponent(requireString(name, 'name'))}`, { method: 'DELETE' });
  }

  async listAccessRequests(options: { state?: TeleportAccessRequest['state']; user?: string } = {}): Promise<unknown> {
    return this.client.request('/v1/access_requests', {
      query: { state: options.state, user: options.user },
    });
  }

  async getAccessRequest(id: string): Promise<unknown> {
    return this.client.request(`/v1/access_requests/${encodeURIComponent(requireString(id, 'id'))}`);
  }

  async createAccessRequest(options: {
    user: string;
    roles: string[];
    resourceIds?: TeleportResourceId[];
    reason?: string;
    suggestedReviewers?: string[];
  }): Promise<unknown> {
    return this.client.request('/v1/access_requests', {
      method: 'POST',
      body: {
        user: options.user,
        roles: options.roles,
        resource_ids: options.resourceIds,
        request_reason: options.reason,
        suggested_reviewers: options.suggestedReviewers,
      },
    });
  }

  async approveAccessRequest(id: string, reason?: string): Promise<unknown> {
    return this.client.request(`/v1/access_requests/${encodeURIComponent(requireString(id, 'id'))}/review`, {
      method: 'POST',
      body: { state: 'APPROVED', reason },
    });
  }

  async denyAccessRequest(id: string, reason?: string): Promise<unknown> {
    return this.client.request(`/v1/access_requests/${encodeURIComponent(requireString(id, 'id'))}/review`, {
      method: 'POST',
      body: { state: 'DENIED', reason },
    });
  }

  async deleteAccessRequest(id: string): Promise<unknown> {
    return this.client.request(`/v1/access_requests/${encodeURIComponent(requireString(id, 'id'))}`, { method: 'DELETE' });
  }

  async listTokens(): Promise<unknown> {
    return this.client.request('/v1/tokens');
  }

  async createToken(options: { roles: string[]; ttl?: string; name?: string; allowedCidrs?: string[] }): Promise<unknown> {
    return this.client.request('/v1/tokens', {
      method: 'POST',
      body: {
        roles: options.roles,
        ttl: options.ttl,
        name: options.name,
        allowed_cidrs: options.allowedCidrs,
      },
    });
  }

  async deleteToken(name: string): Promise<unknown> {
    return this.client.request(`/v1/tokens/${encodeURIComponent(requireString(name, 'name'))}`, { method: 'DELETE' });
  }

  async getAuditEvents(options: {
    from: string;
    to: string;
    eventType?: string[];
    pageSize?: number;
    startKey?: string;
    order?: 'ASC' | 'DESC';
  }): Promise<unknown> {
    return this.client.request('/v1/events/search', {
      query: {
        from: options.from,
        to: options.to,
        event_type: options.eventType,
        page_size: options.pageSize,
        start_key: options.startKey,
        order: options.order,
      },
    });
  }

  async getSessionRecording(sessionId: string): Promise<unknown> {
    return this.client.request(`/v1/sessions/${encodeURIComponent(requireString(sessionId, 'sessionId'))}/recording`);
  }

  async listAuthConnectors(): Promise<unknown> {
    return this.client.request('/v1/auth_connectors');
  }

  async upsertAuthConnector(connector: TeleportAuthConnector): Promise<unknown> {
    return this.client.request('/v1/auth_connectors', { method: 'POST', body: connector });
  }

  async deleteAuthConnector(kind: TeleportAuthConnector['kind'], name: string): Promise<unknown> {
    return this.client.request(
      `/v1/auth_connectors/${encodeURIComponent(kind)}/${encodeURIComponent(requireString(name, 'name'))}`,
      { method: 'DELETE' },
    );
  }

  getClient(): TeleportClient {
    return this.client;
  }
}
