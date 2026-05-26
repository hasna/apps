// Microsoft OneDrive Connector — Cloud file storage and sharing via Graph API
import { OneDriveClient } from './client';
import type { OneDriveConfig, ODDriveItem, ODDriveItemList, ODDrive, ODPermission } from '../types';
export { OneDriveClient } from './client';

export class OneDrive {
  private readonly client: OneDriveClient;
  constructor(config: OneDriveConfig) { this.client = new OneDriveClient(config); }
  static fromEnv(): OneDrive {
    const token = process.env.ONEDRIVE_TOKEN;
    if (!token) throw new Error('ONEDRIVE_TOKEN is required');
    return new OneDrive({ token });
  }

  async getDrive(): Promise<ODDrive> { return this.client.request<ODDrive>('/me/drive'); }

  async listChildren(itemId?: string): Promise<ODDriveItemList> {
    const path = itemId ? `/me/drive/items/${itemId}/children` : '/me/drive/root/children';
    return this.client.request<ODDriveItemList>(path);
  }
  async getItem(itemId: string): Promise<ODDriveItem> { return this.client.request<ODDriveItem>(`/me/drive/items/${itemId}`); }
  async getItemByPath(path: string): Promise<ODDriveItem> { return this.client.request<ODDriveItem>(`/me/drive/root:/${path}`); }
  async deleteItem(itemId: string): Promise<void> { await this.client.request(`/me/drive/items/${itemId}`, { method: 'DELETE' }); }
  async moveItem(itemId: string, parentId: string, newName?: string): Promise<ODDriveItem> {
    return this.client.request<ODDriveItem>(`/me/drive/items/${itemId}`, { method: 'PATCH', body: { parentReference: { id: parentId }, name: newName } as Record<string, unknown> });
  }
  async copyItem(itemId: string, parentId: string, newName?: string): Promise<void> {
    await this.client.request(`/me/drive/items/${itemId}/copy`, { method: 'POST', body: { parentReference: { id: parentId }, name: newName } as Record<string, unknown> });
  }

  async createFolder(parentId: string, name: string): Promise<ODDriveItem> {
    const path = parentId ? `/me/drive/items/${parentId}/children` : '/me/drive/root/children';
    return this.client.request<ODDriveItem>(path, { method: 'POST', body: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' } });
  }

  async search(query: string): Promise<ODDriveItemList> {
    return this.client.request<ODDriveItemList>(`/me/drive/root/search(q='${encodeURIComponent(query)}')`);
  }

  async createSharingLink(itemId: string, type: 'view' | 'edit', scope?: 'anonymous' | 'organization'): Promise<{ link: { webUrl: string } }> {
    return this.client.request(`/me/drive/items/${itemId}/createLink`, { method: 'POST', body: { type, scope: scope || 'anonymous' } });
  }
  async listPermissions(itemId: string): Promise<{ value: ODPermission[] }> {
    return this.client.request(`/me/drive/items/${itemId}/permissions`);
  }

  async getRecentFiles(): Promise<ODDriveItemList> { return this.client.request<ODDriveItemList>('/me/drive/recent'); }
  async getSharedWithMe(): Promise<ODDriveItemList> { return this.client.request<ODDriveItemList>('/me/drive/sharedWithMe'); }

  getClient(): OneDriveClient { return this.client; }
}
