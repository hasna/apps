import type { PhotosClient } from './client';
import type {
  MediaItem,
  MediaItemsListResponse,
  ListMediaItemsOptions,
  SearchMediaItemsRequest,
  Filters,
  ContentCategory,
  MediaType,
} from '../types';

export class MediaApi {
  constructor(private client: PhotosClient) {}

  /**
   * List media items in the user's library
   */
  async list(options: ListMediaItemsOptions = {}): Promise<MediaItemsListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      pageSize: options.pageSize || 25,
      pageToken: options.pageToken,
    };

    return this.client.get<MediaItemsListResponse>('/mediaItems', params);
  }

  /**
   * Get all media items (handles pagination)
   */
  async listAll(options: Omit<ListMediaItemsOptions, 'pageToken'> = {}, maxItems?: number): Promise<MediaItem[]> {
    const items: MediaItem[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.list({ ...options, pageToken });
      if (response.mediaItems) {
        items.push(...response.mediaItems);
        if (maxItems && items.length >= maxItems) {
          return items.slice(0, maxItems);
        }
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    return items;
  }

  /**
   * Get a specific media item by ID
   */
  async get(mediaItemId: string): Promise<MediaItem> {
    return this.client.get<MediaItem>(`/mediaItems/${mediaItemId}`);
  }

  /**
   * Get multiple media items by IDs
   */
  async batchGet(mediaItemIds: string[]): Promise<{ mediaItemResults: Array<{ mediaItem?: MediaItem; status?: { message: string } }> }> {
    const params: Record<string, string> = {};
    mediaItemIds.forEach((id, index) => {
      params[`mediaItemIds[${index}]`] = id;
    });

    return this.client.get<{ mediaItemResults: Array<{ mediaItem?: MediaItem; status?: { message: string } }> }>(
      '/mediaItems:batchGet',
      params
    );
  }

  /**
   * Search for media items
   */
  async search(options: SearchMediaItemsRequest = {}): Promise<MediaItemsListResponse> {
    const body: SearchMediaItemsRequest = {
      pageSize: options.pageSize || 25,
      pageToken: options.pageToken,
    };

    if (options.albumId) {
      body.albumId = options.albumId;
    }

    if (options.filters) {
      body.filters = options.filters;
    }

    if (options.orderBy) {
      body.orderBy = options.orderBy;
    }

    return this.client.post<MediaItemsListResponse>('/mediaItems:search', body);
  }

  /**
   * Search all media items (handles pagination)
   */
  async searchAll(options: Omit<SearchMediaItemsRequest, 'pageToken'> = {}, maxItems?: number): Promise<MediaItem[]> {
    const items: MediaItem[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.search({ ...options, pageToken });
      if (response.mediaItems) {
        items.push(...response.mediaItems);
        if (maxItems && items.length >= maxItems) {
          return items.slice(0, maxItems);
        }
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    return items;
  }

  /**
   * Search for photos/videos by date
   */
  async searchByDate(
    startDate: { year: number; month: number; day: number },
    endDate?: { year: number; month: number; day: number },
    options: Omit<SearchMediaItemsRequest, 'filters' | 'pageToken'> = {}
  ): Promise<MediaItem[]> {
    const filters: Filters = {
      dateFilter: endDate
        ? { ranges: [{ startDate, endDate }] }
        : { dates: [startDate] },
    };

    return this.searchAll({ ...options, filters });
  }

  /**
   * Search for photos/videos by content category
   */
  async searchByCategory(
    categories: ContentCategory[],
    options: Omit<SearchMediaItemsRequest, 'filters' | 'pageToken'> = {}
  ): Promise<MediaItem[]> {
    const filters: Filters = {
      contentFilter: {
        includedContentCategories: categories,
      },
    };

    return this.searchAll({ ...options, filters });
  }

  /**
   * Search for only photos or only videos
   */
  async searchByMediaType(
    mediaTypes: MediaType[],
    options: Omit<SearchMediaItemsRequest, 'filters' | 'pageToken'> = {}
  ): Promise<MediaItem[]> {
    const filters: Filters = {
      mediaTypeFilter: { mediaTypes },
    };

    return this.searchAll({ ...options, filters });
  }

  /**
   * Get favorites
   */
  async getFavorites(options: Omit<SearchMediaItemsRequest, 'filters' | 'pageToken'> = {}): Promise<MediaItem[]> {
    const filters: Filters = {
      featureFilter: {
        includedFeatures: ['FAVORITES'],
      },
    };

    return this.searchAll({ ...options, filters });
  }

  /**
   * Get media items in an album
   */
  async getInAlbum(albumId: string, options: Omit<SearchMediaItemsRequest, 'albumId' | 'pageToken'> = {}): Promise<MediaItem[]> {
    return this.searchAll({ ...options, albumId });
  }

  /**
   * Get the download URL for a media item
   * @param mediaItem The media item
   * @param width Optional width for photos (default: original)
   * @param height Optional height for photos (default: original)
   */
  getDownloadUrl(mediaItem: MediaItem, width?: number, height?: number): string {
    let url = mediaItem.baseUrl;

    // For photos, append size parameters
    if (mediaItem.mediaMetadata.photo) {
      if (width && height) {
        url += `=w${width}-h${height}`;
      } else if (width) {
        url += `=w${width}`;
      } else if (height) {
        url += `=h${height}`;
      } else {
        // Original size
        url += `=d`;
      }
    }

    // For videos, append download parameter
    if (mediaItem.mediaMetadata.video) {
      url += '=dv';
    }

    return url;
  }

  /**
   * Download a media item to a buffer
   */
  async download(mediaItem: MediaItem, width?: number, height?: number): Promise<Buffer> {
    const url = this.getDownloadUrl(mediaItem, width, height);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download media item: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Update description of a media item (only for items created by this app)
   */
  async updateDescription(mediaItemId: string, description: string): Promise<MediaItem> {
    return this.client.patch<MediaItem>(
      `/mediaItems/${mediaItemId}`,
      { description },
      { updateMask: 'description' }
    );
  }
}
