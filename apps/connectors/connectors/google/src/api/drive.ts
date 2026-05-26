import type { GoogleClient } from './client';
import type {
  DriveFile,
  DriveListFilesResponse,
  DriveCreateParams,
  DriveUpdateParams,
  DrivePermission,
  DrivePermissionCreateParams,
} from '../types';

/**
 * Google Drive API module
 * https://www.googleapis.com/drive/v3
 */
export class DriveApi {
  constructor(private readonly client: GoogleClient) {}

  // ============================================
  // Files
  // ============================================

  /**
   * List files in the user's Drive
   */
  async listFiles(options?: {
    pageSize?: number;
    pageToken?: string;
    q?: string;
    orderBy?: string;
    fields?: string;
    spaces?: 'drive' | 'appDataFolder' | 'photos';
    corpora?: 'user' | 'domain' | 'drive' | 'allDrives';
    driveId?: string;
    includeItemsFromAllDrives?: boolean;
    supportsAllDrives?: boolean;
  }): Promise<DriveListFilesResponse> {
    return this.client.driveGet<DriveListFilesResponse>('/files', {
      pageSize: options?.pageSize || 100,
      pageToken: options?.pageToken,
      q: options?.q,
      orderBy: options?.orderBy,
      fields: options?.fields || 'files(id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink),nextPageToken',
      spaces: options?.spaces,
      corpora: options?.corpora,
      driveId: options?.driveId,
      includeItemsFromAllDrives: options?.includeItemsFromAllDrives,
      supportsAllDrives: options?.supportsAllDrives,
    });
  }

  /**
   * Get a file by ID
   */
  async getFile(fileId: string, options?: {
    fields?: string;
    acknowledgeAbuse?: boolean;
    supportsAllDrives?: boolean;
  }): Promise<DriveFile> {
    return this.client.driveGet<DriveFile>(`/files/${fileId}`, {
      fields: options?.fields || '*',
      acknowledgeAbuse: options?.acknowledgeAbuse,
      supportsAllDrives: options?.supportsAllDrives,
    });
  }

  /**
   * Create a new file or folder
   */
  async createFile(params: DriveCreateParams): Promise<DriveFile> {
    const metadata: Record<string, unknown> = {
      name: params.name,
    };

    if (params.mimeType) {
      metadata.mimeType = params.mimeType;
    }

    if (params.parents) {
      metadata.parents = params.parents;
    }

    if (params.description) {
      metadata.description = params.description;
    }

    // For simple metadata-only creation (folders, shortcuts, etc.)
    if (!params.content) {
      return this.client.drivePost<DriveFile>('/files', metadata, {
        fields: '*',
      });
    }

    // For files with content, use multipart upload
    // Note: For larger files, consider using resumable upload
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${params.mimeType || 'text/plain'}\r\n\r\n` +
      params.content +
      closeDelimiter;

    return this.client.request<DriveFile>('drive', '/files', {
      method: 'POST',
      params: {
        uploadType: 'multipart',
        fields: '*',
      },
      body: multipartBody,
      headers: {
        'Content-Type': `multipart/related; boundary="${boundary}"`,
      },
    });
  }

  /**
   * Create a folder
   */
  async createFolder(name: string, options?: {
    parents?: string[];
    description?: string;
  }): Promise<DriveFile> {
    return this.createFile({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: options?.parents,
      description: options?.description,
    });
  }

  /**
   * Update file metadata
   */
  async updateFile(fileId: string, params: DriveUpdateParams): Promise<DriveFile> {
    const body: Record<string, unknown> = {};

    if (params.name !== undefined) body.name = params.name;
    if (params.description !== undefined) body.description = params.description;
    if (params.mimeType !== undefined) body.mimeType = params.mimeType;
    if (params.starred !== undefined) body.starred = params.starred;
    if (params.trashed !== undefined) body.trashed = params.trashed;

    const queryParams: Record<string, string | undefined> = {
      fields: '*',
    };

    if (params.addParents) {
      queryParams.addParents = params.addParents.join(',');
    }

    if (params.removeParents) {
      queryParams.removeParents = params.removeParents.join(',');
    }

    return this.client.drivePatch<DriveFile>(`/files/${fileId}`, body, queryParams);
  }

  /**
   * Delete a file permanently
   */
  async deleteFile(fileId: string, options?: {
    supportsAllDrives?: boolean;
  }): Promise<void> {
    await this.client.driveDelete(`/files/${fileId}`, {
      supportsAllDrives: options?.supportsAllDrives,
    });
  }

  /**
   * Move a file to trash
   */
  async trashFile(fileId: string): Promise<DriveFile> {
    return this.updateFile(fileId, { trashed: true });
  }

  /**
   * Restore a file from trash
   */
  async untrashFile(fileId: string): Promise<DriveFile> {
    return this.updateFile(fileId, { trashed: false });
  }

  /**
   * Copy a file
   */
  async copyFile(fileId: string, options?: {
    name?: string;
    parents?: string[];
  }): Promise<DriveFile> {
    const body: Record<string, unknown> = {};

    if (options?.name) body.name = options.name;
    if (options?.parents) body.parents = options.parents;

    return this.client.drivePost<DriveFile>(`/files/${fileId}/copy`, body, {
      fields: '*',
    });
  }

  /**
   * Empty the trash
   */
  async emptyTrash(): Promise<void> {
    await this.client.driveDelete('/files/trash');
  }

  // ============================================
  // Permissions
  // ============================================

  /**
   * List permissions for a file
   */
  async listPermissions(fileId: string, options?: {
    pageSize?: number;
    pageToken?: string;
    supportsAllDrives?: boolean;
  }): Promise<{ permissions: DrivePermission[]; nextPageToken?: string }> {
    return this.client.driveGet(`/files/${fileId}/permissions`, {
      pageSize: options?.pageSize || 100,
      pageToken: options?.pageToken,
      supportsAllDrives: options?.supportsAllDrives,
      fields: 'permissions(id,type,role,emailAddress,domain,displayName,expirationTime,deleted),nextPageToken',
    });
  }

  /**
   * Get a permission by ID
   */
  async getPermission(fileId: string, permissionId: string, options?: {
    supportsAllDrives?: boolean;
  }): Promise<DrivePermission> {
    return this.client.driveGet<DrivePermission>(`/files/${fileId}/permissions/${permissionId}`, {
      supportsAllDrives: options?.supportsAllDrives,
      fields: '*',
    });
  }

  /**
   * Create a permission (share a file)
   */
  async createPermission(fileId: string, params: DrivePermissionCreateParams): Promise<DrivePermission> {
    const body: Record<string, unknown> = {
      type: params.type,
      role: params.role,
    };

    if (params.emailAddress) body.emailAddress = params.emailAddress;
    if (params.domain) body.domain = params.domain;

    return this.client.drivePost<DrivePermission>(`/files/${fileId}/permissions`, body, {
      sendNotificationEmail: params.sendNotificationEmail,
      emailMessage: params.emailMessage,
      fields: '*',
    });
  }

  /**
   * Update a permission
   */
  async updatePermission(fileId: string, permissionId: string, role: DrivePermission['role']): Promise<DrivePermission> {
    return this.client.drivePatch<DrivePermission>(`/files/${fileId}/permissions/${permissionId}`, {
      role,
    }, {
      fields: '*',
    });
  }

  /**
   * Delete a permission (unshare a file)
   */
  async deletePermission(fileId: string, permissionId: string): Promise<void> {
    await this.client.driveDelete(`/files/${fileId}/permissions/${permissionId}`);
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Search for files with a query
   */
  async search(query: string, options?: {
    pageSize?: number;
    pageToken?: string;
    orderBy?: string;
  }): Promise<DriveListFilesResponse> {
    return this.listFiles({
      q: query,
      pageSize: options?.pageSize,
      pageToken: options?.pageToken,
      orderBy: options?.orderBy,
    });
  }

  /**
   * Get files in a specific folder
   */
  async listFilesInFolder(folderId: string, options?: {
    pageSize?: number;
    pageToken?: string;
    orderBy?: string;
  }): Promise<DriveListFilesResponse> {
    return this.listFiles({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: options?.pageSize,
      pageToken: options?.pageToken,
      orderBy: options?.orderBy,
    });
  }

  /**
   * Get files by MIME type
   */
  async listFilesByMimeType(mimeType: string, options?: {
    pageSize?: number;
    pageToken?: string;
  }): Promise<DriveListFilesResponse> {
    return this.listFiles({
      q: `mimeType = '${mimeType}' and trashed = false`,
      pageSize: options?.pageSize,
      pageToken: options?.pageToken,
    });
  }

  /**
   * List all folders
   */
  async listFolders(options?: {
    pageSize?: number;
    pageToken?: string;
  }): Promise<DriveListFilesResponse> {
    return this.listFilesByMimeType('application/vnd.google-apps.folder', options);
  }

  /**
   * List all Google Docs
   */
  async listDocs(options?: {
    pageSize?: number;
    pageToken?: string;
  }): Promise<DriveListFilesResponse> {
    return this.listFilesByMimeType('application/vnd.google-apps.document', options);
  }

  /**
   * List all Google Sheets
   */
  async listSheets(options?: {
    pageSize?: number;
    pageToken?: string;
  }): Promise<DriveListFilesResponse> {
    return this.listFilesByMimeType('application/vnd.google-apps.spreadsheet', options);
  }

  /**
   * List all Google Slides
   */
  async listSlides(options?: {
    pageSize?: number;
    pageToken?: string;
  }): Promise<DriveListFilesResponse> {
    return this.listFilesByMimeType('application/vnd.google-apps.presentation', options);
  }
}
