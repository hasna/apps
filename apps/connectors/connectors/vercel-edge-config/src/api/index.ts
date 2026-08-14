import { VercelEdgeConfigClient } from './client';
import type {
  VercelEdgeConfigConfig,
  EdgeConfig,
  EdgeConfigListResponse,
  EdgeConfigCreateParams,
  EdgeConfigUpdateParams,
  EdgeConfigItemsPatchParams,
  EdgeConfigItem,
  EdgeConfigToken,
  EdgeConfigBackup,
} from '../types';

export { VercelEdgeConfigClient, DEFAULT_BASE_URL } from './client';

/**
 * Vercel Edge Config management API wrapper (api.vercel.com/v1/edge-config).
 */
export class VercelEdgeConfig {
  private client: VercelEdgeConfigClient;

  constructor(config: VercelEdgeConfigConfig) {
    this.client = new VercelEdgeConfigClient(config);
  }

  getClient(): VercelEdgeConfigClient {
    return this.client;
  }

  async listEdgeConfigs(params?: { slug?: string }): Promise<EdgeConfigListResponse> {
    return this.client.get<EdgeConfigListResponse>('/v1/edge-config', params);
  }

  async createEdgeConfig(body: EdgeConfigCreateParams): Promise<EdgeConfig> {
    return this.client.post<EdgeConfig>('/v1/edge-config', body as unknown as Record<string, unknown>);
  }

  async getEdgeConfig(edgeConfigId: string, params?: { slug?: string }): Promise<EdgeConfig> {
    return this.client.get<EdgeConfig>(`/v1/edge-config/${encodeURIComponent(edgeConfigId)}`, params);
  }

  async updateEdgeConfig(edgeConfigId: string, body: EdgeConfigUpdateParams): Promise<EdgeConfig> {
    return this.client.put<EdgeConfig>(
      `/v1/edge-config/${encodeURIComponent(edgeConfigId)}`,
      body as unknown as Record<string, unknown>,
    );
  }

  async deleteEdgeConfig(edgeConfigId: string): Promise<void> {
    await this.client.delete(`/v1/edge-config/${encodeURIComponent(edgeConfigId)}`);
  }

  async patchItems(edgeConfigId: string, body: EdgeConfigItemsPatchParams): Promise<{ status: string }> {
    return this.client.patch<{ status: string }>(
      `/v1/edge-config/${encodeURIComponent(edgeConfigId)}/items`,
      body as unknown as Record<string, unknown>,
    );
  }

  async getItem(edgeConfigId: string, key: string): Promise<EdgeConfigItem> {
    return this.client.get<EdgeConfigItem>(
      `/v1/edge-config/${encodeURIComponent(edgeConfigId)}/item/${encodeURIComponent(key)}`,
    );
  }

  async getSchema(edgeConfigId: string): Promise<Record<string, unknown>> {
    return this.client.get<Record<string, unknown>>(
      `/v1/edge-config/${encodeURIComponent(edgeConfigId)}/schema`,
    );
  }

  async listTokens(edgeConfigId: string): Promise<{ tokens: EdgeConfigToken[] }> {
    return this.client.get<{ tokens: EdgeConfigToken[] }>(
      `/v1/edge-config/${encodeURIComponent(edgeConfigId)}/tokens`,
    );
  }

  async createToken(edgeConfigId: string, label?: string): Promise<EdgeConfigToken> {
    return this.client.post<EdgeConfigToken>(
      `/v1/edge-config/${encodeURIComponent(edgeConfigId)}/token`,
      label ? { label } : {},
    );
  }

  async listBackups(edgeConfigId: string): Promise<{ backups: EdgeConfigBackup[] }> {
    return this.client.get<{ backups: EdgeConfigBackup[] }>(
      `/v1/edge-config/${encodeURIComponent(edgeConfigId)}/backups`,
    );
  }

  async rawRequest<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[];
    },
  ): Promise<T> {
    return this.client.request<T>(path, {
      method,
      params: options?.params,
      body: options?.body,
    });
  }
}
