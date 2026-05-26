import type { DriveClient } from './client.ts';
import type { About, StorageQuota, User } from '../types/index.ts';

export class StorageApi {
  constructor(private client: DriveClient) {}

  /**
   * Get storage quota information
   */
  async getQuota(): Promise<StorageQuota> {
    const about = await this.client.get<About>('/about', {
      fields: 'storageQuota',
    });
    return about.storageQuota || {};
  }

  /**
   * Get user information
   */
  async getUser(): Promise<User> {
    const about = await this.client.get<About>('/about', {
      fields: 'user',
    });
    return about.user || {};
  }

  /**
   * Get full about information
   */
  async getAbout(): Promise<About> {
    return this.client.get<About>('/about', {
      fields: 'kind,user,storageQuota,maxUploadSize,appInstalled,folderColorPalette,canCreateDrives',
    });
  }

  /**
   * Get import/export formats
   */
  async getFormats(): Promise<{ importFormats: Record<string, string[]>; exportFormats: Record<string, string[]> }> {
    const about = await this.client.get<About>('/about', {
      fields: 'importFormats,exportFormats',
    });
    return {
      importFormats: about.importFormats || {},
      exportFormats: about.exportFormats || {},
    };
  }
}
