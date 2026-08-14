import type { UpCloudClient } from './client';
import type { Storage, StorageCreateParams, StorageModifyParams } from '../types';

export type StorageType = 'normal' | 'public' | 'private' | 'backup' | 'cdrom' | 'template' | 'favorite';

export class StorageApi {
  constructor(private client: UpCloudClient) {}

  async listStorages(type?: StorageType): Promise<{ storages: { storage: Storage[] } }> {
    const path = type ? `/storage/${encodeURIComponent(type)}` : '/storage';
    return this.client.get<{ storages: { storage: Storage[] } }>(path);
  }

  async getStorage(uuid: string): Promise<{ storage: Storage }> {
    return this.client.get<{ storage: Storage }>(`/storage/${encodeURIComponent(uuid)}`);
  }

  async createStorage(params: StorageCreateParams): Promise<{ storage: Storage }> {
    return this.client.post<{ storage: Storage }>('/storage', { storage: params });
  }

  async modifyStorage(uuid: string, params: StorageModifyParams): Promise<{ storage: Storage }> {
    return this.client.put<{ storage: Storage }>(`/storage/${encodeURIComponent(uuid)}`, { storage: params });
  }

  async deleteStorage(uuid: string, backups?: 'keep' | 'keep_latest' | 'delete'): Promise<void> {
    const params = backups ? { backups } : undefined;
    await this.client.delete(`/storage/${encodeURIComponent(uuid)}`, params);
  }

  async attachStorage(serverUuid: string, storageUuid: string, options?: { type?: 'disk' | 'cdrom'; address?: string }): Promise<unknown> {
    return this.client.post(`/server/${encodeURIComponent(serverUuid)}/storage/attach`, {
      storage_device: {
        storage: storageUuid,
        type: options?.type,
        address: options?.address,
      },
    });
  }

  async detachStorage(serverUuid: string, address: string): Promise<unknown> {
    return this.client.post(`/server/${encodeURIComponent(serverUuid)}/storage/detach`, {
      storage_device: { address },
    });
  }
}
