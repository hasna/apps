import type { DriveClient } from './client.ts';
import type { DriveFile, FileListResponse } from '../types/index.ts';
import { MIME_TYPES } from '../types/index.ts';

const DEFAULT_FILE_FIELDS = 'id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,webContentLink,trashed,starred,shared,owners';

export class FoldersApi {
  constructor(private client: DriveClient) {}

  /**
   * List folders (optionally within a parent folder)
   */
  async list(parentId?: string): Promise<FileListResponse> {
    let q = "mimeType = '" + MIME_TYPES.FOLDER + "' and trashed = false";
    
    if (parentId) {
      q += " and '" + parentId + "' in parents";
    }

    return this.client.get<FileListResponse>('/files', {
      q,
      pageSize: 100,
      orderBy: 'name',
      fields: 'nextPageToken,files(' + DEFAULT_FILE_FIELDS + ')',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
  }

  /**
   * List contents of a folder (files and subfolders)
   */
  async listContents(folderId: string): Promise<FileListResponse> {
    const q = "'" + folderId + "' in parents and trashed = false";

    return this.client.get<FileListResponse>('/files', {
      q,
      pageSize: 100,
      orderBy: 'folder,name',
      fields: 'nextPageToken,files(' + DEFAULT_FILE_FIELDS + ')',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
  }

  /**
   * Get a folder by ID
   */
  async get(folderId: string): Promise<DriveFile> {
    return this.client.get<DriveFile>('/files/' + folderId, {
      fields: DEFAULT_FILE_FIELDS,
      supportsAllDrives: true,
    });
  }

  /**
   * Create a new folder
   */
  async create(name: string, parentId?: string): Promise<DriveFile> {
    const metadata: Record<string, unknown> = {
      name,
      mimeType: MIME_TYPES.FOLDER,
    };

    if (parentId) {
      metadata.parents = [parentId];
    }

    return this.client.post<DriveFile>('/files', metadata, {
      fields: DEFAULT_FILE_FIELDS,
      supportsAllDrives: true,
    });
  }

  /**
   * Delete a folder (moves to trash by default)
   */
  async delete(folderId: string, permanent = false): Promise<void> {
    if (permanent) {
      await this.client.delete('/files/' + folderId, { supportsAllDrives: true });
    } else {
      await this.client.patch<DriveFile>('/files/' + folderId, { trashed: true }, {
        supportsAllDrives: true,
      });
    }
  }

  /**
   * Rename a folder
   */
  async rename(folderId: string, newName: string): Promise<DriveFile> {
    return this.client.patch<DriveFile>('/files/' + folderId, { name: newName }, {
      fields: DEFAULT_FILE_FIELDS,
      supportsAllDrives: true,
    });
  }

  /**
   * Move a folder to a new parent
   */
  async move(folderId: string, newParentId: string): Promise<DriveFile> {
    const folder = await this.get(folderId);
    const currentParents = folder.parents?.join(',') || '';

    return this.client.patch<DriveFile>('/files/' + folderId, {}, {
      addParents: newParentId,
      removeParents: currentParents,
      fields: DEFAULT_FILE_FIELDS,
      supportsAllDrives: true,
    });
  }

  /**
   * Get folder path (breadcrumb)
   */
  async getPath(folderId: string): Promise<DriveFile[]> {
    const path: DriveFile[] = [];
    let currentId = folderId;

    while (currentId) {
      const folder = await this.get(currentId);
      path.unshift(folder);
      
      if (folder.parents && folder.parents.length > 0) {
        currentId = folder.parents[0] as string;
      } else {
        break;
      }
    }

    return path;
  }
}
