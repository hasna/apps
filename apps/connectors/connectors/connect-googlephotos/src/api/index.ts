import { PhotosClient } from './client';
import { AlbumsApi } from './albums';
import { MediaApi } from './media';
import { UploadApi } from './upload';

export { PhotosClient } from './client';
export { AlbumsApi } from './albums';
export { MediaApi } from './media';
export { UploadApi } from './upload';

/**
 * Main Google Photos API client
 * Provides access to all Google Photos Library API functionality
 */
export class GooglePhotos {
  private client: PhotosClient;

  /**
   * Albums API - manage photo albums
   */
  public readonly albums: AlbumsApi;

  /**
   * Media API - access and search media items
   */
  public readonly media: MediaApi;

  /**
   * Upload API - upload photos and videos
   */
  public readonly upload: UploadApi;

  constructor() {
    this.client = new PhotosClient();
    this.albums = new AlbumsApi(this.client);
    this.media = new MediaApi(this.client);
    this.upload = new UploadApi(this.client);
  }

  /**
   * Create a new GooglePhotos instance
   */
  static create(): GooglePhotos {
    return new GooglePhotos();
  }

  /**
   * Get the underlying HTTP client for advanced usage
   */
  getClient(): PhotosClient {
    return this.client;
  }
}
