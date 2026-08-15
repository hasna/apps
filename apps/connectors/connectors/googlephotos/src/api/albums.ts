import type { PhotosClient } from './client';
import type {
  Album,
  AlbumsListResponse,
  ListAlbumsOptions,
  ShareAlbumRequest,
  ShareAlbumResponse,
  SharedAlbumOptions,
} from '../types';

export class AlbumsApi {
  constructor(private client: PhotosClient) {}

  /**
   * List all albums in the user's library
   */
  async list(options: ListAlbumsOptions = {}): Promise<AlbumsListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      pageSize: options.pageSize || 50,
      pageToken: options.pageToken,
      excludeNonAppCreatedData: options.excludeNonAppCreatedData,
    };

    return this.client.get<AlbumsListResponse>('/albums', params);
  }

  /**
   * Get all albums (handles pagination)
   */
  async listAll(options: Omit<ListAlbumsOptions, 'pageToken'> = {}): Promise<Album[]> {
    const albums: Album[] = [];
    let pageToken: string | undefined;

    do {
      const response = await this.list({ ...options, pageToken });
      if (response.albums) {
        albums.push(...response.albums);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    return albums;
  }

  /**
   * Get a specific album by ID
   */
  async get(albumId: string): Promise<Album> {
    return this.client.get<Album>(`/albums/${albumId}`);
  }

  /**
   * Create a new album
   */
  async create(title: string): Promise<Album> {
    return this.client.post<Album>('/albums', {
      album: { title },
    });
  }

  /**
   * Add an enrichment (text, location, or map) to an album
   */
  async addEnrichment(
    albumId: string,
    enrichment: {
      textEnrichment?: { text: string };
      locationEnrichment?: {
        location: {
          locationName: string;
          latlng?: { latitude: number; longitude: number };
        };
      };
      mapEnrichment?: {
        origin: {
          locationName: string;
          latlng?: { latitude: number; longitude: number };
        };
        destination: {
          locationName: string;
          latlng?: { latitude: number; longitude: number };
        };
      };
    },
    position: 'FIRST_IN_ALBUM' | 'LAST_IN_ALBUM' = 'LAST_IN_ALBUM'
  ): Promise<{ enrichmentItem: { id: string } }> {
    return this.client.post<{ enrichmentItem: { id: string } }>(
      `/albums/${albumId}:addEnrichment`,
      {
        newEnrichmentItem: enrichment,
        albumPosition: { position },
      }
    );
  }

  /**
   * Share an album
   */
  async share(albumId: string, options?: SharedAlbumOptions): Promise<ShareAlbumResponse> {
    const request: ShareAlbumRequest = {};
    if (options) {
      request.sharedAlbumOptions = options;
    }
    return this.client.post<ShareAlbumResponse>(`/albums/${albumId}:share`, request);
  }

  /**
   * Unshare an album
   */
  async unshare(albumId: string): Promise<void> {
    await this.client.post<void>(`/albums/${albumId}:unshare`, {});
  }

  /**
   * List shared albums
   */
  async listShared(options: ListAlbumsOptions = {}): Promise<AlbumsListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      pageSize: options.pageSize || 50,
      pageToken: options.pageToken,
      excludeNonAppCreatedData: options.excludeNonAppCreatedData,
    };

    return this.client.get<AlbumsListResponse>('/sharedAlbums', params);
  }

  /**
   * Join a shared album using a share token
   */
  async join(shareToken: string): Promise<Album> {
    return this.client.post<Album>('/sharedAlbums:join', { shareToken });
  }

  /**
   * Leave a shared album
   */
  async leave(shareToken: string): Promise<void> {
    await this.client.post<void>('/sharedAlbums:leave', { shareToken });
  }

  /**
   * Add media items to an album
   */
  async addMediaItems(albumId: string, mediaItemIds: string[]): Promise<void> {
    await this.client.post<void>(`/albums/${albumId}:batchAddMediaItems`, {
      mediaItemIds,
    });
  }

  /**
   * Remove media items from an album
   */
  async removeMediaItems(albumId: string, mediaItemIds: string[]): Promise<void> {
    await this.client.post<void>(`/albums/${albumId}:batchRemoveMediaItems`, {
      mediaItemIds,
    });
  }

  /**
   * Update album title (only for albums created by this app)
   */
  async updateTitle(albumId: string, title: string): Promise<Album> {
    return this.client.patch<Album>(
      `/albums/${albumId}`,
      { title },
      { updateMask: 'title' }
    );
  }

  /**
   * Update album cover photo (only for albums created by this app)
   */
  async updateCoverPhoto(albumId: string, coverPhotoMediaItemId: string): Promise<Album> {
    return this.client.patch<Album>(
      `/albums/${albumId}`,
      { coverPhotoMediaItemId },
      { updateMask: 'coverPhotoMediaItemId' }
    );
  }
}
