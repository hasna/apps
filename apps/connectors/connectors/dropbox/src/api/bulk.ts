import type { DropboxClient } from './client';
import type { Metadata, FileMetadata, RelocationBatchV2Result } from '../types';

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually modify */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, item: unknown) => void;
  /** Error callback */
  onError?: (error: Error, item: unknown) => void;
}

export interface PathSummary {
  path: string;
  displayName?: string;
}

export interface BulkDeleteOptions extends BulkOperationOptions {
  /** Paths to delete */
  paths: string[];
}

export interface BulkDeleteResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ path: string; error: string }>;
  deletedPaths: string[];
}

export interface CopyEntry {
  fromPath: string;
  toPath: string;
}

export interface BulkCopyOptions extends BulkOperationOptions {
  /** Source/destination path pairs */
  entries: CopyEntry[];
  /** Autorename if destination exists */
  autorename?: boolean;
  /** Allow shared folders */
  allowSharedFolder?: boolean;
}

export interface CopyResult {
  fromPath: string;
  toPath: string;
  metadata?: Metadata;
}

export interface BulkCopyResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ fromPath: string; toPath: string; error: string }>;
  results: CopyResult[];
}

export interface MoveEntry {
  fromPath: string;
  toPath: string;
}

export interface BulkMoveOptions extends BulkOperationOptions {
  /** Source/destination path pairs */
  entries: MoveEntry[];
  /** Autorename if destination exists */
  autorename?: boolean;
  /** Allow shared folders */
  allowSharedFolder?: boolean;
}

export interface MoveResult {
  fromPath: string;
  toPath: string;
  metadata?: Metadata;
}

export interface BulkMoveResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ fromPath: string; toPath: string; error: string }>;
  results: MoveResult[];
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: DropboxClient;

  constructor(client: DropboxClient) {
    this.client = client;
  }

  // ============================================
  // Delete Batch
  // ============================================

  /**
   * Bulk delete files and folders
   */
  async delete(options: BulkDeleteOptions): Promise<BulkDeleteResult> {
    const { paths, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkDeleteResult = {
      total: paths.length,
      success: 0,
      failed: 0,
      errors: [],
      deletedPaths: [],
    };

    if (paths.length === 0) return result;

    const chunks = this.chunkArray(paths, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (path) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              await this.client.post('/files/delete_v2', { path });
              result.success++;
              result.deletedPaths.push(path);
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, path);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ path, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), path);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Copy Batch
  // ============================================

  /**
   * Bulk copy files and folders
   */
  async copy(options: BulkCopyOptions): Promise<BulkCopyResult> {
    const { entries, concurrency = 10, dryRun = false, autorename = false, allowSharedFolder = false, onProgress, onError } = options;

    const result: BulkCopyResult = {
      total: entries.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (entries.length === 0) return result;

    const chunks = this.chunkArray(entries, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (entry) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const response = await this.client.post<RelocationBatchV2Result>('/files/copy_v2', {
                from_path: entry.fromPath,
                to_path: entry.toPath,
                autorename,
                allow_shared_folder: allowSharedFolder,
              });
              result.success++;
              result.results.push({
                fromPath: entry.fromPath,
                toPath: entry.toPath,
                metadata: (response as unknown as { metadata: Metadata }).metadata,
              });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, entry);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({
              fromPath: entry.fromPath,
              toPath: entry.toPath,
              error: errorMessage,
            });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), entry);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Move Batch
  // ============================================

  /**
   * Bulk move files and folders
   */
  async move(options: BulkMoveOptions): Promise<BulkMoveResult> {
    const { entries, concurrency = 10, dryRun = false, autorename = false, allowSharedFolder = false, onProgress, onError } = options;

    const result: BulkMoveResult = {
      total: entries.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (entries.length === 0) return result;

    const chunks = this.chunkArray(entries, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (entry) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const response = await this.client.post<RelocationBatchV2Result>('/files/move_v2', {
                from_path: entry.fromPath,
                to_path: entry.toPath,
                autorename,
                allow_shared_folder: allowSharedFolder,
              });
              result.success++;
              result.results.push({
                fromPath: entry.fromPath,
                toPath: entry.toPath,
                metadata: (response as unknown as { metadata: Metadata }).metadata,
              });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, entry);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({
              fromPath: entry.fromPath,
              toPath: entry.toPath,
              error: errorMessage,
            });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), entry);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Helper Methods
  // ============================================

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
