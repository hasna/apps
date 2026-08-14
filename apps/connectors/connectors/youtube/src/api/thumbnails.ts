import type { YouTubeClient } from './client';
import type { ThumbnailDetails } from '../types';

export interface ThumbnailSetResponse {
  kind: 'youtube#thumbnailSetResponse';
  etag: string;
  items: Array<{
    default?: ThumbnailDetails['default'];
    medium?: ThumbnailDetails['medium'];
    high?: ThumbnailDetails['high'];
    standard?: ThumbnailDetails['standard'];
    maxres?: ThumbnailDetails['maxres'];
  }>;
}

export class ThumbnailsApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * Set a custom thumbnail for a video
   * Quota cost: 50 units
   *
   * Note: This requires the video owner to have verified their account
   * and the image should be:
   * - 1280x720 pixels (min 640x360)
   * - Under 2MB
   * - JPG, GIF, or PNG format
   */
  async set(
    videoId: string,
    imageData: Buffer | Uint8Array,
    contentType: 'image/jpeg' | 'image/png' | 'image/gif' = 'image/jpeg',
    onBehalfOfContentOwner?: string
  ): Promise<ThumbnailSetResponse> {
    // Initialize resumable upload for thumbnail
    const uploadUrl = await this.client.initResumableUpload(
      '/thumbnails/set',
      {},
      contentType,
      imageData.length
    );

    // Upload the image
    const data = imageData instanceof Uint8Array ? imageData : new Uint8Array(imageData);
    const result = await this.client.uploadChunk(uploadUrl, data, 0, data.length);

    if (result.complete) {
      return result.response as ThumbnailSetResponse;
    }

    throw new Error('Thumbnail upload did not complete');
  }

  /**
   * Set thumbnail from a file path (Node.js/Bun environment)
   */
  async setFromFile(
    videoId: string,
    filePath: string,
    onBehalfOfContentOwner?: string
  ): Promise<ThumbnailSetResponse> {
    const { readFileSync } = await import('fs');
    const imageData = readFileSync(filePath);

    // Determine content type from file extension
    let contentType: 'image/jpeg' | 'image/png' | 'image/gif' = 'image/jpeg';
    const ext = filePath.toLowerCase().split('.').pop();
    if (ext === 'png') contentType = 'image/png';
    else if (ext === 'gif') contentType = 'image/gif';

    return this.set(videoId, imageData, contentType, onBehalfOfContentOwner);
  }
}
