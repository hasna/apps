import type { DriveClient } from './client.ts';
import type { DriveFile, FileListResponse, ListFilesOptions, Permission, CreatePermissionOptions } from '../types/index.ts';
import { MIME_TYPES } from '../types/index.ts';
import { readFileSync, writeFileSync } from 'fs';
import { basename, extname } from 'path';

const DEFAULT_FILE_FIELDS = 'id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,webContentLink,trashed,starred,shared,owners,permissions';

export class FilesApi {
  constructor(private client: DriveClient) {}

  /**
   * List files in Drive
   */
  async list(options: ListFilesOptions = {}): Promise<FileListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      pageSize: options.pageSize || 100,
      pageToken: options.pageToken,
      q: options.q,
      orderBy: options.orderBy || 'modifiedTime desc',
      fields: options.fields || 'nextPageToken,files(' + DEFAULT_FILE_FIELDS + ')',
      spaces: options.spaces || 'drive',
      supportsAllDrives: options.supportsAllDrives ?? true,
      includeItemsFromAllDrives: options.includeItemsFromAllDrives ?? true,
    };

    if (options.corpora) {
      params.corpora = options.corpora;
    }
    if (options.driveId) {
      params.driveId = options.driveId;
    }

    return this.client.get<FileListResponse>('/files', params);
  }

  /**
   * Get a file by ID
   */
  async get(fileId: string, fields?: string): Promise<DriveFile> {
    return this.client.get<DriveFile>('/files/' + fileId, {
      fields: fields || DEFAULT_FILE_FIELDS,
      supportsAllDrives: true,
    });
  }

  /**
   * Download a file
   */
  async download(fileId: string, destPath?: string): Promise<{ data: ArrayBuffer; filename: string }> {
    const file = await this.get(fileId);
    
    // Check if it's a Google Workspace file that needs export
    if (file.mimeType.startsWith('application/vnd.google-apps.')) {
      const exportMimeType = this.getExportMimeType(file.mimeType);
      if (!exportMimeType) {
        throw new Error('Cannot download Google Workspace file type: ' + file.mimeType);
      }
      
      const data = await this.client.export(fileId, exportMimeType);
      const ext = this.getExtensionForMimeType(exportMimeType);
      const filename = file.name + ext;
      
      if (destPath) {
        writeFileSync(destPath, Buffer.from(data));
      }
      
      return { data, filename };
    }

    const data = await this.client.download(fileId);
    const filename = file.name;
    
    if (destPath) {
      writeFileSync(destPath, Buffer.from(data));
    }
    
    return { data, filename };
  }

  /**
   * Upload a file
   */
  async upload(filePath: string, options?: { name?: string; folderId?: string; mimeType?: string }): Promise<DriveFile> {
    const content = readFileSync(filePath);
    const name = options?.name || basename(filePath);
    
    const metadata: Record<string, unknown> = { name };
    
    if (options?.folderId) {
      metadata.parents = [options.folderId];
    }

    const mimeType = options?.mimeType || this.getMimeTypeFromExtension(extname(filePath));
    
    return this.client.upload<DriveFile>(
      '/files',
      content,
      metadata,
      { fields: DEFAULT_FILE_FIELDS },
      mimeType
    );
  }

  /**
   * Create a file with content
   */
  async create(name: string, content: string | Buffer, options?: { folderId?: string; mimeType?: string }): Promise<DriveFile> {
    const metadata: Record<string, unknown> = { name };
    
    if (options?.folderId) {
      metadata.parents = [options.folderId];
    }

    const buffer = typeof content === 'string' ? Buffer.from(content) : content;
    const mimeType = options?.mimeType || 'text/plain';
    
    return this.client.upload<DriveFile>(
      '/files',
      buffer,
      metadata,
      { fields: DEFAULT_FILE_FIELDS },
      mimeType
    );
  }

  /**
   * Update file metadata
   */
  async update(fileId: string, metadata: Partial<DriveFile>): Promise<DriveFile> {
    return this.client.patch<DriveFile>('/files/' + fileId, metadata as Record<string, unknown>, {
      fields: DEFAULT_FILE_FIELDS,
      supportsAllDrives: true,
    });
  }

  /**
   * Delete a file permanently
   */
  async delete(fileId: string): Promise<void> {
    await this.client.delete('/files/' + fileId, { supportsAllDrives: true });
  }

  /**
   * Move a file to trash
   */
  async trash(fileId: string): Promise<DriveFile> {
    return this.update(fileId, { trashed: true });
  }

  /**
   * Restore a file from trash
   */
  async untrash(fileId: string): Promise<DriveFile> {
    return this.update(fileId, { trashed: false });
  }

  /**
   * Move a file to a new parent folder
   */
  async move(fileId: string, newParentId: string): Promise<DriveFile> {
    const file = await this.get(fileId);
    const currentParents = file.parents?.join(',') || '';

    return this.client.patch<DriveFile>('/files/' + fileId, {}, {
      addParents: newParentId,
      removeParents: currentParents,
      fields: DEFAULT_FILE_FIELDS,
      supportsAllDrives: true,
    });
  }

  /**
   * Copy a file
   */
  async copy(fileId: string, options?: { name?: string; folderId?: string }): Promise<DriveFile> {
    const metadata: Record<string, unknown> = {};
    
    if (options?.name) {
      metadata.name = options.name;
    }
    if (options?.folderId) {
      metadata.parents = [options.folderId];
    }

    return this.client.post<DriveFile>('/files/' + fileId + '/copy', metadata, {
      fields: DEFAULT_FILE_FIELDS,
      supportsAllDrives: true,
    });
  }

  /**
   * Share a file with a user
   */
  async share(fileId: string, email: string, role: 'reader' | 'writer' | 'commenter' | 'owner', options?: CreatePermissionOptions): Promise<Permission> {
    const permission: Partial<Permission> = {
      type: 'user',
      role,
      emailAddress: email,
    };

    const params: Record<string, string | number | boolean | undefined> = {
      supportsAllDrives: true,
      sendNotificationEmail: options?.sendNotificationEmail ?? true,
    };

    if (options?.emailMessage) {
      params.emailMessage = options.emailMessage;
    }
    if (options?.transferOwnership) {
      params.transferOwnership = options.transferOwnership;
    }

    return this.client.post<Permission>('/files/' + fileId + '/permissions', permission as Record<string, unknown>, params);
  }

  /**
   * List permissions for a file
   */
  async listPermissions(fileId: string): Promise<{ permissions: Permission[] }> {
    return this.client.get<{ permissions: Permission[] }>('/files/' + fileId + '/permissions', {
      supportsAllDrives: true,
      fields: 'permissions(id,type,role,emailAddress,displayName,domain)',
    });
  }

  /**
   * Remove a permission from a file
   */
  async removePermission(fileId: string, permissionId: string): Promise<void> {
    await this.client.delete('/files/' + fileId + '/permissions/' + permissionId, {
      supportsAllDrives: true,
    });
  }

  /**
   * Search files
   */
  async search(query: string, options?: { pageSize?: number; pageToken?: string }): Promise<FileListResponse> {
    // Build search query
    const q = "fullText contains '" + query.replace(/'/g, "\\'") + "' and trashed = false";
    
    return this.list({
      q,
      pageSize: options?.pageSize,
      pageToken: options?.pageToken,
    });
  }

  private getExportMimeType(googleMimeType: string): string | null {
    const exportMap: Record<string, string> = {
      [MIME_TYPES.DOCUMENT]: MIME_TYPES.DOCX,
      [MIME_TYPES.SPREADSHEET]: MIME_TYPES.XLSX,
      [MIME_TYPES.PRESENTATION]: MIME_TYPES.PPTX,
      [MIME_TYPES.DRAWING]: MIME_TYPES.PNG,
    };
    return exportMap[googleMimeType] || null;
  }

  private getExtensionForMimeType(mimeType: string): string {
    const extMap: Record<string, string> = {
      [MIME_TYPES.DOCX]: '.docx',
      [MIME_TYPES.XLSX]: '.xlsx',
      [MIME_TYPES.PPTX]: '.pptx',
      [MIME_TYPES.PDF]: '.pdf',
      [MIME_TYPES.PNG]: '.png',
      [MIME_TYPES.JPEG]: '.jpg',
      [MIME_TYPES.CSV]: '.csv',
      [MIME_TYPES.TXT]: '.txt',
      [MIME_TYPES.HTML]: '.html',
    };
    return extMap[mimeType] || '';
  }

  private getMimeTypeFromExtension(ext: string): string {
    const mimeMap: Record<string, string> = {
      '.txt': 'text/plain',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': MIME_TYPES.DOCX,
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': MIME_TYPES.XLSX,
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': MIME_TYPES.PPTX,
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.zip': 'application/zip',
      '.gz': 'application/gzip',
      '.tar': 'application/x-tar',
    };
    return mimeMap[ext.toLowerCase()] || 'application/octet-stream';
  }
}
