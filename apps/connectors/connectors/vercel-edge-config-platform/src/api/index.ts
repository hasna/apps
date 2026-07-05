import { EdgeConfigPlatformClient } from './client';
import type {
  EdgeConfigPlatformConfig,
  EdgeConfig,
  EdgeConfigCreateParams,
  EdgeConfigUpdateParams,
  EdgeConfigItem,
  EdgeConfigItemsPatchParams,
  EdgeConfigItemsPatchResponse,
  EdgeConfigSchemaUpdateParams,
  EdgeConfigToken,
  EdgeConfigTokenCreateParams,
  EdgeConfigTokenCreateResponse,
  EdgeConfigTokensDeleteParams,
  EdgeConfigBackup,
} from '../types';

export { EdgeConfigPlatformClient };

/**
 * Vercel Edge Config management API wrapper (api.vercel.com/v1/edge-config)
 */
export class EdgeConfigPlatform {
  private client: EdgeConfigPlatformClient;

  constructor(config: EdgeConfigPlatformConfig) {
    this.client = new EdgeConfigPlatformClient(config);
  }

  getClient(): EdgeConfigPlatformClient {
    return this.client;
  }

  // Edge Config CRUD

  async listEdgeConfigs(): Promise<EdgeConfig[]> {
    return this.client.get<EdgeConfig[]>('/v1/edge-config');
  }

  async createEdgeConfig(params: EdgeConfigCreateParams): Promise<EdgeConfig> {
    return this.client.post<EdgeConfig>('/v1/edge-config', params);
  }

  async getEdgeConfig(edgeConfigId: string): Promise<EdgeConfig> {
    return this.client.get<EdgeConfig>(`/v1/edge-config/${edgeConfigId}`);
  }

  async updateEdgeConfig(edgeConfigId: string, params: EdgeConfigUpdateParams): Promise<EdgeConfig> {
    return this.client.put<EdgeConfig>(`/v1/edge-config/${edgeConfigId}`, params);
  }

  async deleteEdgeConfig(edgeConfigId: string): Promise<void> {
    await this.client.delete(`/v1/edge-config/${edgeConfigId}`);
  }

  // Items

  async listItems(edgeConfigId: string): Promise<EdgeConfigItem[]> {
    return this.client.get<EdgeConfigItem[]>(`/v1/edge-config/${edgeConfigId}/items`);
  }

  async getItem(edgeConfigId: string, itemKey: string): Promise<EdgeConfigItem> {
    return this.client.get<EdgeConfigItem>(`/v1/edge-config/${edgeConfigId}/item/${itemKey}`);
  }

  async patchItems(edgeConfigId: string, params: EdgeConfigItemsPatchParams): Promise<EdgeConfigItemsPatchResponse> {
    return this.client.patch<EdgeConfigItemsPatchResponse>(`/v1/edge-config/${edgeConfigId}/items`, params);
  }

  // Schema

  async getSchema(edgeConfigId: string): Promise<Record<string, unknown> | null> {
    return this.client.get<Record<string, unknown> | null>(`/v1/edge-config/${edgeConfigId}/schema`);
  }

  async updateSchema(
    edgeConfigId: string,
    params: EdgeConfigSchemaUpdateParams,
    options?: { dryRun?: boolean }
  ): Promise<Record<string, unknown> | null> {
    return this.client.post<Record<string, unknown> | null>(
      `/v1/edge-config/${edgeConfigId}/schema`,
      params,
      options?.dryRun !== undefined ? { dryRun: String(options.dryRun) } : undefined
    );
  }

  async deleteSchema(edgeConfigId: string): Promise<void> {
    await this.client.delete(`/v1/edge-config/${edgeConfigId}/schema`);
  }

  // Tokens

  async listTokens(edgeConfigId: string): Promise<EdgeConfigToken> {
    return this.client.get<EdgeConfigToken>(`/v1/edge-config/${edgeConfigId}/tokens`);
  }

  async getToken(edgeConfigId: string, token: string): Promise<EdgeConfigToken> {
    return this.client.get<EdgeConfigToken>(`/v1/edge-config/${edgeConfigId}/token/${token}`);
  }

  async createToken(edgeConfigId: string, params: EdgeConfigTokenCreateParams): Promise<EdgeConfigTokenCreateResponse> {
    return this.client.post<EdgeConfigTokenCreateResponse>(`/v1/edge-config/${edgeConfigId}/token`, params);
  }

  async deleteTokens(edgeConfigId: string, params: EdgeConfigTokensDeleteParams): Promise<void> {
    await this.client.delete(`/v1/edge-config/${edgeConfigId}/tokens`, undefined, params as Record<string, unknown>);
  }

  // Backups

  async listBackups(edgeConfigId: string): Promise<EdgeConfigBackup[]> {
    return this.client.get<EdgeConfigBackup[]>(`/v1/edge-config/${edgeConfigId}/backups`);
  }

  async getBackup(edgeConfigId: string, backupVersionId: string): Promise<EdgeConfigBackup> {
    return this.client.get<EdgeConfigBackup>(`/v1/edge-config/${edgeConfigId}/backups/${backupVersionId}`);
  }

  async restoreBackup(edgeConfigId: string, backupVersionId: string): Promise<EdgeConfig> {
    return this.client.post<EdgeConfig>(`/v1/edge-config/${edgeConfigId}/backups/${backupVersionId}/restore`, {});
  }
}
