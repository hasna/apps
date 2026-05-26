import type { PhotosClient } from './client';
import type { MediaItem, MediaItemsListResponse, Album } from '../types';

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
  /** Filter by album ID */
  albumId?: string;
  /** Filter by media type (PHOTO, VIDEO) */
  mediaType?: 'PHOTO' | 'VIDEO';
  /** Include archived media */
  includeArchived?: boolean;
  /** Only favorites */
  favoritesOnly?: boolean;
  /** Maximum items to process (default: 100) */
  maxResults?: number;
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually modify */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, item: MediaSummary) => void;
  /** Error callback */
  onError?: (error: Error, item: MediaSummary) => void;
}

export interface BulkAddToAlbumOptions extends BulkOperationOptions {
  /** Album ID to add items to */
  targetAlbumId: string;
  /** Media item IDs to add (or use filters above to discover) */
  mediaItemIds?: string[];
}

export interface BulkRemoveFromAlbumOptions {
  /** Album ID to remove items from */
  albumId: string;
  /** Media item IDs to remove (or use filters to discover) */
  mediaItemIds?: string[];
  /** Filter options if mediaItemIds not provided */
  albumId?: string;
  mediaType?: 'PHOTO' | 'VIDEO';
  maxResults?: number;
  concurrency?: number;
  dryRun?: boolean;
  onProgress?: (current: number, total: number, item: MediaSummary) => void;
  onError?: (error: Error, item: MediaSummary) => void;
}

export interface BulkCreateAlbumsOptions {
  /** Album titles to create */
  titles: string[];
  concurrency?: number;
  dryRun?: boolean;
  onProgress?: (current: number, total: number, title: string) => void;
  onError?: (error: Error, title: string) => void;
}

export interface MediaSummary {
  id: string;
  filename: string;
  mimeType: string;
  created: string;
  productUrl: string;
}

export interface BulkOperationResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ mediaId: string; error: string }>;
  processedItems: MediaSummary[];
}

export interface PreviewResult {
  items: MediaSummary[];
  total: number;
}

export interface BulkCreateAlbumsResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ title: string; error: string }>;
  createdAlbums: Album[];
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: PhotosClient;

  constructor(client: PhotosClient) {
    this.client = client;
  }

  // ============================================
  // Preview
  // ============================================

  /**
   * Preview media items matching filters
   */
  async preview(options?: {
    albumId?: string;
    mediaType?: 'PHOTO' | 'VIDEO';
    favoritesOnly?: boolean;
    maxResults?: number;
  }): Promise<PreviewResult> {
    const items = await this.fetchMediaItems({
      albumId: options?.albumId,
      mediaType: options?.mediaType,
      favoritesOnly: options?.favoritesOnly,
      maxResults: options?.maxResults || 50,
    });
    return { items, total: items.length };
  }

  // ============================================
  // Delete (Archive)
  // ============================================

  /**
   * Note: Google Photos API doesn't support direct delete.
   * This archives media items by moving them out of albums.
   * For true deletion, users must use the Google Photos UI.
   */
  async removeFromAlbums(options: {
    albumIds: string[];
    mediaItemIds?: string[];
    maxResults?: number;
    concurrency?: number;
    dryRun?: boolean;
    onProgress?: (current: number, total: number, item: MediaSummary) => void;
    onError?: (error: Error, item: MediaSummary) => void;
  }): Promise<BulkOperationResult> {
    const { albumIds, mediaItemIds, ...rest } = options;

    let items: MediaSummary[];
    if (mediaItemIds && mediaItemIds.length > 0) {
      items = mediaItemIds.map(id => ({
        id,
        filename: id,
        mimeType: 'unknown',
        created: '',
        productUrl: '',
      }));
    } else {
      items = await this.fetchMediaItems({
        albumId: albumIds[0],
        maxResults: rest.maxResults || 100,
      });
    }

    return this.executeBatch(items, {
      dryRun: rest.dryRun || false,
      concurrency: rest.concurrency || 10,
      onProgress: rest.onProgress,
      onError: rest.onError,
      operation: async (item) => {
        for (const albumId of albumIds) {
          await this.client.post<void>(`/albums/${albumId}:batchRemoveMediaItems`, {
            mediaItemIds: [item.id],
          });
        }
      },
    });
  }

  // ============================================
  // Add to Album
  // ============================================

  /**
   * Bulk add media items to an album
   */
  async addToAlbum(options: BulkAddToAlbumOptions): Promise<BulkOperationResult> {
    let itemIds = options.mediaItemIds;

    if (!itemIds || itemIds.length === 0) {
      const items = await this.fetchMediaItems({
        albumId: options.albumId,
        mediaType: options.mediaType,
        favoritesOnly: options.favoritesOnly,
        includeArchived: options.includeArchived,
        maxResults: options.maxResults || 100,
      });
      itemIds = items.map(i => i.id);
    }

    const summaries = itemIds.map(id => ({
      id,
      filename: id,
      mimeType: 'unknown',
      created: '',
      productUrl: '',
    }));

    return this.executeBatch(summaries, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (item) => {
        await this.client.post<void>(`/albums/${options.targetAlbumId}:batchAddMediaItems`, {
          mediaItemIds: [item.id],
        });
      },
    });
  }

  // ============================================
  // Remove from Album
  // ============================================

  /**
   * Bulk remove media items from an album
   */
  async removeFromAlbum(options: {
    albumId: string;
    mediaItemIds?: string[];
    maxResults?: number;
    concurrency?: number;
    dryRun?: boolean;
    onProgress?: (current: number, total: number, item: MediaSummary) => void;
    onError?: (error: Error, item: MediaSummary) => void;
  }): Promise<BulkOperationResult> {
    let itemIds = options.mediaItemIds;

    if (!itemIds || itemIds.length === 0) {
      const items = await this.fetchMediaItems({
        albumId: options.albumId,
        maxResults: options.maxResults || 100,
      });
      itemIds = items.map(i => i.id);
    }

    const summaries = itemIds.map(id => ({
      id,
      filename: id,
      mimeType: 'unknown',
      created: '',
      productUrl: '',
    }));

    return this.executeBatch(summaries, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (item) => {
        await this.client.post<void>(`/albums/${options.albumId}:batchRemoveMediaItems`, {
          mediaItemIds: [item.id],
        });
      },
    });
  }

  // ============================================
  // Create Albums
  // ============================================

  /**
   * Bulk create albums from a list of titles
   */
  async createAlbums(options: BulkCreateAlbumsOptions): Promise<BulkCreateAlbumsResult> {
    const { titles, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkCreateAlbumsResult = {
      total: titles.length,
      success: 0,
      failed: 0,
      errors: [],
      createdAlbums: [],
    };

    if (titles.length === 0) return result;

    const chunks = this.chunkArray(titles, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (title) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const album = await this.client.post<Album>('/albums', { album: { title } });
              result.success++;
              result.createdAlbums.push(album);
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, title);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ title, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), title);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Favorite / Unfavorite
  // ============================================

  /**
   * Note: Google Photos API doesn't support setting favorite status via API.
   * This is read-only through the featureFilter. Listed for completeness.
   */
  async listFavorites(options?: { maxResults?: number }): Promise<PreviewResult> {
    const items = await this.fetchMediaItems({
      favoritesOnly: true,
      maxResults: options?.maxResults || 100,
    });
    return { items, total: items.length };
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Fetch media items matching filters
   */
  async fetchMediaItems(params: {
    albumId?: string;
    mediaType?: 'PHOTO' | 'VIDEO';
    favoritesOnly?: boolean;
    includeArchived?: boolean;
    maxResults?: number;
  }): Promise<MediaSummary[]> {
    const items: MediaSummary[] = [];
    let pageToken: string | undefined;
    const max = params.maxResults || 100;

    while (items.length < max) {
      const body: Record<string, unknown> = {
        pageSize: Math.min(100, max - items.length),
      };

      if (params.albumId) {
        body.albumId = params.albumId;
      }

      const filters: Record<string, unknown> = {};
      if (params.mediaType) {
        filters.mediaTypeFilter = { mediaTypes: [params.mediaType] };
      }
      if (params.favoritesOnly) {
        filters.featureFilter = { includedFeatures: ['FAVORITES'] };
      }
      if (params.includeArchived) {
        filters.includeArchivedMedia = true;
      }
      if (Object.keys(filters).length > 0) {
        body.filters = filters;
      }

      if (pageToken) {
        body.pageToken = pageToken;
      }

      const response = await this.client.post<MediaItemsListResponse>('/mediaItems:search', body);

      if (!response.mediaItems || response.mediaItems.length === 0) break;

      for (const item of response.mediaItems) {
        items.push({
          id: item.id,
          filename: item.filename,
          mimeType: item.mimeType,
          created: item.mediaMetadata.creationTime,
          productUrl: item.productUrl,
        });
      }

      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }

    return items;
  }

  /**
   * Execute operations in batches with concurrency control
   */
  private async executeBatch(
    items: MediaSummary[],
    options: {
      dryRun: boolean;
      concurrency: number;
      onProgress?: (current: number, total: number, item: MediaSummary) => void;
      onError?: (error: Error, item: MediaSummary) => void;
      operation: (item: MediaSummary) => Promise<void>;
    }
  ): Promise<BulkOperationResult> {
    const { dryRun, concurrency, onProgress, onError, operation } = options;

    const result: BulkOperationResult = {
      total: items.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      processedItems: [],
    };

    if (items.length === 0) return result;

    const chunks = this.chunkArray(items, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (item) => {
          try {
            if (dryRun) {
              result.success++;
              result.processedItems.push(item);
            } else {
              await operation(item);
              result.success++;
              result.processedItems.push(item);
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, item);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ mediaId: item.id, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), item);
          }
        })
      );
    }

    return result;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
