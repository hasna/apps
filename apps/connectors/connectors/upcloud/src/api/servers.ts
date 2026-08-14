import type { UpCloudClient } from './client';
import type { Server, ServerCreateParams, ServerModifyParams } from '../types';

export class ServersApi {
  constructor(private client: UpCloudClient) {}

  async listServers(): Promise<{ servers: { server: Server[] } }> {
    return this.client.get<{ servers: { server: Server[] } }>('/server');
  }

  async getServer(uuid: string): Promise<{ server: Server }> {
    return this.client.get<{ server: Server }>(`/server/${encodeURIComponent(uuid)}`);
  }

  async createServer(params: ServerCreateParams): Promise<{ server: Server }> {
    return this.client.post<{ server: Server }>('/server', { server: params });
  }

  async modifyServer(uuid: string, params: ServerModifyParams): Promise<{ server: Server }> {
    return this.client.put<{ server: Server }>(`/server/${encodeURIComponent(uuid)}`, { server: params });
  }

  async deleteServer(uuid: string, options?: { storages?: 0 | 1; backups?: 'keep' | 'keep_latest' | 'delete' }): Promise<void> {
    const params: Record<string, string | number> = {};
    if (options?.storages !== undefined) params.storages = options.storages;
    if (options?.backups) params.backups = options.backups;
    await this.client.delete(`/server/${encodeURIComponent(uuid)}`, params);
  }

  async startServer(uuid: string, options?: { avoid_host?: number; host?: number }): Promise<unknown> {
    return this.client.post(`/server/${encodeURIComponent(uuid)}/start`, {
      server: options,
    });
  }

  async stopServer(uuid: string, options?: { stop_type?: 'soft' | 'hard'; timeout?: number }): Promise<unknown> {
    return this.client.post(`/server/${encodeURIComponent(uuid)}/stop`, {
      stop_server: {
        stop_type: options?.stop_type ?? 'soft',
        timeout: options?.timeout,
      },
    });
  }

  async restartServer(uuid: string, options?: { stop_type?: 'soft' | 'hard'; timeout?: number; timeout_action?: 'destroy' | 'ignore' }): Promise<unknown> {
    return this.client.post(`/server/${encodeURIComponent(uuid)}/restart`, {
      restart_server: {
        stop_type: options?.stop_type ?? 'soft',
        timeout: options?.timeout,
        timeout_action: options?.timeout_action,
      },
    });
  }
}
