// Zoho Vault Connector — password and secrets management
import { ZohoVaultClient } from './client';
import type {
  ZohoVaultApiResponse,
  ZohoVaultChamber,
  ZohoVaultConfig,
  ZohoVaultGroup,
  ZohoVaultSecret,
  ZohoVaultSharePermission,
  ZohoVaultUser,
} from '../types';

export { ZohoVaultClient, DC_BASES, resolveBaseUrl } from './client';

export class ZohoVault {
  private readonly client: ZohoVaultClient;

  constructor(config: ZohoVaultConfig) {
    this.client = new ZohoVaultClient(config);
  }

  static fromEnv(): ZohoVault {
    const token = process.env.ZOHOVAULT_TOKEN;
    if (!token) throw new Error('ZOHOVAULT_TOKEN is required');
    return new ZohoVault({
      token,
      dataCenter: process.env.ZOHOVAULT_DATA_CENTER,
      baseUrl: process.env.ZOHOVAULT_BASE_URL,
    });
  }

  async listSecrets(options: {
    search?: string;
    limit?: number;
    offset?: number;
    chamberId?: string;
    sortByField?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<ZohoVaultApiResponse> {
    return this.client.request('/secrets', {
      params: {
        search: options.search,
        limit: options.limit,
        offset: options.offset,
        chamberid: options.chamberId,
        sortby: options.sortByField,
        sortorder: options.sortOrder,
      },
    });
  }

  async getSecret(id: string, reason?: string): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/secrets/${encodeURIComponent(id)}`, {
      params: { reason },
    });
  }

  async getSecretPassword(id: string, reason?: string): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/secrets/${encodeURIComponent(id)}/password`, {
      params: { reason },
    });
  }

  async createSecret(options: {
    name: string;
    type?: string;
    chamberId?: string;
    secretData: Record<string, unknown>;
    description?: string;
    tags?: string[];
  }): Promise<ZohoVaultApiResponse> {
    return this.client.request('/secrets', {
      method: 'POST',
      body: {
        name: options.name,
        type: options.type,
        chamberid: options.chamberId,
        secretdata: options.secretData,
        description: options.description,
        tags: options.tags?.join(','),
      },
    });
  }

  async updateSecret(
    id: string,
    options: {
      name?: string;
      secretData?: Record<string, unknown>;
      description?: string;
      tags?: string[];
    },
  ): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/secrets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: {
        name: options.name,
        secretdata: options.secretData,
        description: options.description,
        tags: options.tags?.join(','),
      },
    });
  }

  async deleteSecret(id: string): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/secrets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async searchSecrets(query: string, options: { limit?: number; offset?: number } = {}): Promise<ZohoVaultApiResponse> {
    return this.client.request('/secrets/search', {
      params: { search: query, limit: options.limit, offset: options.offset },
    });
  }

  async listChambers(options: { limit?: number; offset?: number } = {}): Promise<ZohoVaultApiResponse> {
    return this.client.request('/chambers', { params: { limit: options.limit, offset: options.offset } });
  }

  async getChamber(id: string): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/chambers/${encodeURIComponent(id)}`);
  }

  async createChamber(options: { name: string; description?: string }): Promise<ZohoVaultApiResponse> {
    return this.client.request('/chambers', {
      method: 'POST',
      body: { name: options.name, description: options.description },
    });
  }

  async updateChamber(
    id: string,
    options: { name?: string; description?: string },
  ): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/chambers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { name: options.name, description: options.description },
    });
  }

  async deleteChamber(id: string): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/chambers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async addSecretsToChamber(chamberId: string, secretIds: string[]): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/chambers/${encodeURIComponent(chamberId)}/secrets`, {
      method: 'POST',
      body: { secretids: secretIds.join(',') },
    });
  }

  async listUsers(options: { limit?: number; offset?: number } = {}): Promise<ZohoVaultApiResponse> {
    return this.client.request('/users', { params: { limit: options.limit, offset: options.offset } });
  }

  async listGroups(options: { limit?: number; offset?: number } = {}): Promise<ZohoVaultApiResponse> {
    return this.client.request('/usergroups', { params: { limit: options.limit, offset: options.offset } });
  }

  async createGroup(options: {
    name: string;
    description?: string;
    userIds?: string[];
  }): Promise<ZohoVaultApiResponse> {
    return this.client.request('/usergroups', {
      method: 'POST',
      body: {
        name: options.name,
        description: options.description,
        userids: options.userIds?.join(','),
      },
    });
  }

  async deleteGroup(id: string): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/usergroups/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async shareSecret(options: {
    secretId: string;
    userIds?: string[];
    groupIds?: string[];
    permission: ZohoVaultSharePermission;
  }): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/secrets/${encodeURIComponent(options.secretId)}/share`, {
      method: 'POST',
      body: {
        userids: options.userIds?.join(','),
        groupids: options.groupIds?.join(','),
        permission: options.permission,
      },
    });
  }

  async unshareSecret(options: {
    secretId: string;
    userIds?: string[];
    groupIds?: string[];
  }): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/secrets/${encodeURIComponent(options.secretId)}/unshare`, {
      method: 'POST',
      body: {
        userids: options.userIds?.join(','),
        groupids: options.groupIds?.join(','),
      },
    });
  }

  async listShares(secretId: string): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/secrets/${encodeURIComponent(secretId)}/share`);
  }

  async listAuditLogs(options: {
    limit?: number;
    offset?: number;
    from?: string;
    to?: string;
    userId?: string;
    secretId?: string;
    eventType?: string;
  } = {}): Promise<ZohoVaultApiResponse> {
    return this.client.request('/audit', {
      params: {
        limit: options.limit,
        offset: options.offset,
        from: options.from,
        to: options.to,
        userid: options.userId,
        secretid: options.secretId,
        eventtype: options.eventType,
      },
    });
  }

  async listSecretTypes(): Promise<ZohoVaultApiResponse> {
    return this.client.request('/secrettypes');
  }

  async listTags(): Promise<ZohoVaultApiResponse> {
    return this.client.request('/tags');
  }

  async listFavorites(): Promise<ZohoVaultApiResponse> {
    return this.client.request('/secrets/favorites');
  }

  async addToFavorites(secretId: string): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/secrets/${encodeURIComponent(secretId)}/favorites`, { method: 'POST' });
  }

  async removeFromFavorites(secretId: string): Promise<ZohoVaultApiResponse> {
    return this.client.request(`/secrets/${encodeURIComponent(secretId)}/favorites`, { method: 'DELETE' });
  }

  async getOrganization(): Promise<ZohoVaultApiResponse> {
    return this.client.request('/organization');
  }

  async generatePassword(options: {
    length?: number;
    useUppercase?: boolean;
    useLowercase?: boolean;
    useNumbers?: boolean;
    useSpecialChars?: boolean;
  } = {}): Promise<ZohoVaultApiResponse> {
    return this.client.request('/passwords/generate', {
      params: {
        length: options.length,
        uppercase: options.useUppercase,
        lowercase: options.useLowercase,
        numbers: options.useNumbers,
        special: options.useSpecialChars,
      },
    });
  }

  getClient(): ZohoVaultClient {
    return this.client;
  }
}

export type { ZohoVaultSecret, ZohoVaultChamber, ZohoVaultUser, ZohoVaultGroup, ZohoVaultConfig };
