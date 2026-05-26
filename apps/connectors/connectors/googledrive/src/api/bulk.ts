import type { DriveClient } from './client.ts';
import type { DriveFile, FileListResponse, ListFilesOptions } from '../types/index.ts';

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
  /** Drive search query (e.g., "name contains 'report'", "mimeType='application/pdf'") */
  query: string;
  /** Maximum files to process (default: 100) */
  maxResults?: number;
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually modify, just preview */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, file: FileSummary) => void;
  /** Error callback */
  onError?: (error: Error, file: FileSummary) => void;
}

export interface BulkDeleteOptions extends BulkOperationOptions {
  /** Skip permanently deleting, move to trash instead */
  trash?: boolean;
}

export interface BulkMoveOptions extends BulkOperationOptions {
  /** Destination folder ID */
  destinationFolderId: string;
}

export interface BulkRenameOptions extends BulkOperationOptions {
  /** Rename pattern: use 'prefix', 'suffix', or 'replace' */
  mode: 'prefix' | 'suffix' | 'replace' | 'lowercase' | 'uppercase';
  /** New prefix (for mode=prefix) */
  prefix?: string;
  /** New suffix (for mode=suffix, without the dot) */
  suffix?: string;
  /** Text to find (for mode=replace) */
  find?: string;
  /** Replacement text (for mode=replace) */
  replace?: string;
}

export interface BulkShareOptions extends BulkOperationOptions {
  /** Email address to share with */
  email: string;
  /** Permission role */
  role: 'reader' | 'writer' | 'commenter';
  /** Whether to send notification email */
  sendNotification?: boolean;
}

export interface FileSummary {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  webViewLink?: string;
}

export interface BulkOperationResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ fileId: string; error: string }>;
  processedFiles: FileSummary[];
}

export interface PreviewResult {
  files: FileSummary[];
  total: number;
  query: string;
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: DriveClient;

  constructor(client: DriveClient) {
    this.client = client;
  }

  // ============================================
  // Preview Operations
  // ============================================

  /**
   * Preview files matching a query without making changes
   */
  async preview(query: string, maxResults: number = 50): Promise<PreviewResult> {
    const files = await this.fetchFiles(query, maxResults);
    return { files, total: files.length, query };
  }

  // ============================================
  // Trash/Delete Operations
  // ============================================

  /**
   * Bulk move files to trash
   */
  async trash(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const files = await this.fetchFiles(options.query, options.maxResults || 100);

    return this.executeBatch(files, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (file) => {
        await this.client.patch<DriveFile>('/files/' + file.id, { trashed: true }, {
          fields: 'id,name',
          supportsAllDrives: true,
        });
      },
    });
  }

  /**
   * Bulk permanently delete files (DANGER!)
   */
  async delete(options: BulkDeleteOptions): Promise<BulkOperationResult> {
    const files = await this.fetchFiles(options.query, options.maxResults || 100);

    return this.executeBatch(files, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (file) => {
        if (options.trash) {
          await this.client.patch<DriveFile>('/files/' + file.id, { trashed: true }, {
            fields: 'id,name',
            supportsAllDrives: true,
          });
        } else {
          await this.client.delete('/files/' + file.id, { supportsAllDrives: true });
        }
      },
    });
  }

  /**
   * Bulk restore files from trash
   */
  async untrash(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const files = await this.fetchFiles(options.query, options.maxResults || 100);

    return this.executeBatch(files, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (file) => {
        await this.client.patch<DriveFile>('/files/' + file.id, { trashed: false }, {
          fields: 'id,name',
          supportsAllDrives: true,
        });
      },
    });
  }

  // ============================================
  // Move Operations
  // ============================================

  /**
   * Bulk move files to a different folder
   */
  async move(options: BulkMoveOptions): Promise<BulkOperationResult> {
    const files = await this.fetchFiles(options.query, options.maxResults || 100);

    return this.executeBatch(files, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (file) => {
        // Get current parents to remove them
        const fullFile = await this.client.get<DriveFile>('/files/' + file.id, {
          fields: 'parents',
          supportsAllDrives: true,
        });
        const currentParents = fullFile.parents?.join(',') || '';

        await this.client.patch<DriveFile>('/files/' + file.id, {}, {
          addParents: options.destinationFolderId,
          removeParents: currentParents,
          fields: 'id,name',
          supportsAllDrives: true,
        });
      },
    });
  }

  // ============================================
  // Rename Operations
  // ============================================

  /**
   * Bulk rename files based on a pattern
   */
  async rename(options: BulkRenameOptions): Promise<BulkOperationResult> {
    const files = await this.fetchFiles(options.query, options.maxResults || 100);

    return this.executeBatch(files, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (file) => {
        const newName = this.applyRenamePattern(file.name, options);
        await this.client.patch<DriveFile>('/files/' + file.id, { name: newName }, {
          fields: 'id,name',
          supportsAllDrives: true,
        });
      },
    });
  }

  // ============================================
  // Share Operations
  // ============================================

  /**
   * Bulk share files with a user
   */
  async share(options: BulkShareOptions): Promise<BulkOperationResult> {
    const files = await this.fetchFiles(options.query, options.maxResults || 100);

    return this.executeBatch(files, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (file) => {
        const permission = {
          type: 'user' as const,
          role: options.role,
          emailAddress: options.email,
        };
        const params: Record<string, string | number | boolean | undefined> = {
          supportsAllDrives: true,
          sendNotificationEmail: options.sendNotification ?? true,
        };
        await this.client.post('/files/' + file.id + '/permissions', permission as Record<string, unknown>, params);
      },
    });
  }

  /**
   * Bulk make files publicly accessible
   */
  async makePublic(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const files = await this.fetchFiles(options.query, options.maxResults || 100);

    return this.executeBatch(files, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (file) => {
        await this.client.post('/files/' + file.id + '/permissions', {
          type: 'anyone',
          role: 'reader',
        }, {
          supportsAllDrives: true,
          sendNotificationEmail: false,
        });
      },
    });
  }

  /**
   * Bulk remove public access from files
   */
  async removePublicAccess(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const files = await this.fetchFiles(options.query, options.maxResults || 100);

    return this.executeBatch(files, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (file) => {
        // List permissions to find the "anyone" permission
        const perms = await this.client.get<{ permissions: Array<{ id: string; type: string }> }>(
          '/files/' + file.id + '/permissions',
          { supportsAllDrives: true, fields: 'permissions(id,type)' }
        );
        const anyonePerm = perms.permissions.find(p => p.type === 'anyone');
        if (anyonePerm) {
          await this.client.delete('/files/' + file.id + '/permissions/' + anyonePerm.id, {
            supportsAllDrives: true,
          });
        }
      },
    });
  }

  // ============================================
  // Star Operations
  // ============================================

  /**
   * Bulk star files
   */
  async star(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const files = await this.fetchFiles(options.query, options.maxResults || 100);

    return this.executeBatch(files, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (file) => {
        await this.client.patch<DriveFile>('/files/' + file.id, { starred: true }, {
          fields: 'id,name',
          supportsAllDrives: true,
        });
      },
    });
  }

  /**
   * Bulk unstar files
   */
  async unstar(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const files = await this.fetchFiles(options.query, options.maxResults || 100);

    return this.executeBatch(files, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (file) => {
        await this.client.patch<DriveFile>('/files/' + file.id, { starred: false }, {
          fields: 'id,name',
          supportsAllDrives: true,
        });
      },
    });
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Fetch files matching a query with metadata
   */
  private async fetchFiles(query: string, maxResults: number): Promise<FileSummary[]> {
    const files: FileSummary[] = [];
    let pageToken: string | undefined;
    const fields = 'id,name,mimeType,size,parents,webViewLink';

    while (files.length < maxResults) {
      const params: Record<string, string | number | boolean | undefined> = {
        pageSize: Math.min(100, maxResults - files.length),
        pageToken,
        q: query,
        fields: 'nextPageToken,files(' + fields + ')',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      };

      const response = await this.client.get<FileListResponse>('/files', params);

      if (!response.files || response.files.length === 0) {
        break;
      }

      for (const f of response.files) {
        files.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size,
          parents: f.parents,
          webViewLink: f.webViewLink,
        });
      }

      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }

    return files;
  }

  /**
   * Apply rename pattern to a file name
   */
  private applyRenamePattern(name: string, options: BulkRenameOptions): string {
    switch (options.mode) {
      case 'prefix':
        return (options.prefix || '') + name;
      case 'suffix': {
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > 0 && !name.startsWith('.')) {
          return name.slice(0, dotIndex) + (options.suffix || '') + name.slice(dotIndex);
        }
        return name + (options.suffix || '');
      }
      case 'replace':
        return options.find ? name.replace(new RegExp(options.find, 'g'), options.replace || '') : name;
      case 'lowercase': {
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > 0 && !name.startsWith('.')) {
          return name.slice(0, dotIndex).toLowerCase() + name.slice(dotIndex);
        }
        return name.toLowerCase();
      }
      case 'uppercase': {
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > 0 && !name.startsWith('.')) {
          return name.slice(0, dotIndex).toUpperCase() + name.slice(dotIndex);
        }
        return name.toUpperCase();
      }
      default:
        return name;
    }
  }

  /**
   * Execute operations in batches with concurrency control
   */
  private async executeBatch(
    files: FileSummary[],
    options: {
      dryRun: boolean;
      concurrency: number;
      onProgress?: (current: number, total: number, file: FileSummary) => void;
      onError?: (error: Error, file: FileSummary) => void;
      operation: (file: FileSummary) => Promise<void>;
    }
  ): Promise<BulkOperationResult> {
    const { dryRun, concurrency, onProgress, onError, operation } = options;

    const result: BulkOperationResult = {
      total: files.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      processedFiles: [],
    };

    if (files.length === 0) {
      return result;
    }

    const chunks = this.chunkArray(files, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (file) => {
          try {
            if (dryRun) {
              result.success++;
              result.processedFiles.push(file);
            } else {
              await operation(file);
              result.success++;
              result.processedFiles.push(file);
            }

            if (onProgress) {
              onProgress(result.success + result.failed, result.total, file);
            }
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ fileId: file.id, error: errorMessage });

            if (onError) {
              onError(err instanceof Error ? err : new Error(errorMessage), file);
            }
          }
        })
      );
    }

    return result;
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
