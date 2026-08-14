import type { DriveClient } from './client.ts';
import type { DriveFile, FileListResponse } from '../types/index.ts';

const DEFAULT_FILE_FIELDS = 'id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,trashed,trashedTime,explicitlyTrashed';

export class TrashApi {
  constructor(private client: DriveClient) {}

  /**
   * List files in trash
   */
  async list(pageSize = 100, pageToken?: string): Promise<FileListResponse> {
    return this.client.get<FileListResponse>('/files', {
      q: 'trashed = true',
      pageSize,
      pageToken,
      orderBy: 'modifiedTime desc',
      fields: 'nextPageToken,files(' + DEFAULT_FILE_FIELDS + ')',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
  }

  /**
   * Restore a file from trash
   */
  async restore(fileId: string): Promise<DriveFile> {
    return this.client.patch<DriveFile>('/files/' + fileId, { trashed: false }, {
      fields: DEFAULT_FILE_FIELDS,
      supportsAllDrives: true,
    });
  }

  /**
   * Permanently delete a file from trash
   */
  async deletePermanently(fileId: string): Promise<void> {
    await this.client.delete('/files/' + fileId, { supportsAllDrives: true });
  }

  /**
   * Empty the entire trash
   */
  async empty(): Promise<void> {
    await this.client.delete('/files/trash');
  }
}
