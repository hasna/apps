import type { SnapClient } from './client';
import type {
  Media,
  MediaCreateParams,
  MediaResponse,
  MediaType,
} from '../types';
import { readFileSync, statSync } from 'fs';
import { basename } from 'path';

// 32 MB chunk size for large file uploads
const CHUNK_SIZE = 32 * 1024 * 1024;

/**
 * Snapchat Media API
 * Upload and manage media files (images, videos)
 */
export class MediaApi {
  constructor(private readonly client: SnapClient) {}

  /**
   * List all media for an ad account
   */
  async list(adAccountId: string): Promise<Media[]> {
    const response = await this.client.get<MediaResponse>(
      `/adaccounts/${adAccountId}/media`
    );
    return response.media?.map(m => m.media) || [];
  }

  /**
   * Get a specific media by ID
   */
  async get(mediaId: string): Promise<Media> {
    const response = await this.client.get<MediaResponse>(`/media/${mediaId}`);
    const media = response.media?.[0]?.media;
    if (!media) {
      throw new Error(`Media ${mediaId} not found`);
    }
    return media;
  }

  /**
   * Create a media placeholder (before upload)
   */
  async create(params: MediaCreateParams): Promise<Media> {
    const response = await this.client.post<MediaResponse>(
      `/adaccounts/${params.ad_account_id}/media`,
      {
        media: [params],
      }
    );
    const media = response.media?.[0]?.media;
    if (!media) {
      throw new Error('Failed to create media');
    }
    return media;
  }

  /**
   * Upload media from a file path
   * Automatically handles chunked upload for large files
   */
  async uploadFile(
    adAccountId: string,
    filePath: string,
    type: MediaType,
    name?: string
  ): Promise<Media> {
    const fileStats = statSync(filePath);
    const fileName = name || basename(filePath);
    const fileSize = fileStats.size;

    // For files larger than chunk size, use chunked upload
    if (fileSize > CHUNK_SIZE) {
      return this.uploadLargeFile(adAccountId, filePath, type, fileName);
    }

    // For smaller files, use direct upload
    return this.uploadSmallFile(adAccountId, filePath, type, fileName);
  }

  /**
   * Upload a small file directly (< 32 MB)
   */
  private async uploadSmallFile(
    adAccountId: string,
    filePath: string,
    type: MediaType,
    fileName: string
  ): Promise<Media> {
    // Create media placeholder
    const media = await this.create({
      ad_account_id: adAccountId,
      type,
      name: fileName,
    });

    // Upload the file
    const fileContent = readFileSync(filePath);
    const blob = new Blob([fileContent]);

    const formData = new FormData();
    formData.append('file', blob, fileName);

    await this.client.upload<{ request_status: string }>(
      `/media/${media.id}/upload`,
      formData
    );

    // Return updated media
    return this.get(media.id);
  }

  /**
   * Upload a large file using chunked upload (> 32 MB)
   */
  private async uploadLargeFile(
    adAccountId: string,
    filePath: string,
    type: MediaType,
    fileName: string
  ): Promise<Media> {
    const fileStats = statSync(filePath);
    const fileSize = fileStats.size;
    const numberOfParts = Math.ceil(fileSize / CHUNK_SIZE);

    // Create media placeholder
    const media = await this.create({
      ad_account_id: adAccountId,
      type,
      name: fileName,
    });

    // Initialize chunked upload
    const initResponse = await this.client.post<{
      request_status: string;
      upload_id: string;
    }>(`/media/${media.id}/multipart-upload`, {
      file_name: fileName,
      file_size: fileSize,
      number_of_parts: numberOfParts,
    });

    const uploadId = initResponse.upload_id;
    const parts: { part_number: number; etag: string }[] = [];

    // Read file content
    const fileContent = readFileSync(filePath);

    // Upload each part
    for (let partNumber = 1; partNumber <= numberOfParts; partNumber++) {
      const start = (partNumber - 1) * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunk = fileContent.slice(start, end);

      const blob = new Blob([chunk]);
      const formData = new FormData();
      formData.append('file', blob, `part_${partNumber}`);

      const partResponse = await this.client.upload<{
        request_status: string;
        etag: string;
      }>(`/media/${media.id}/multipart-upload/${uploadId}/parts/${partNumber}`, formData);

      parts.push({
        part_number: partNumber,
        etag: partResponse.etag,
      });
    }

    // Complete the upload
    await this.client.post<{ request_status: string }>(
      `/media/${media.id}/multipart-upload/${uploadId}/complete`,
      { parts }
    );

    // Return updated media
    return this.get(media.id);
  }

  /**
   * Upload video from a file path
   */
  async uploadVideo(adAccountId: string, filePath: string, name?: string): Promise<Media> {
    return this.uploadFile(adAccountId, filePath, 'VIDEO', name);
  }

  /**
   * Upload image from a file path
   */
  async uploadImage(adAccountId: string, filePath: string, name?: string): Promise<Media> {
    return this.uploadFile(adAccountId, filePath, 'IMAGE', name);
  }

  /**
   * Get thumbnail URL for a media
   */
  async getThumbnail(mediaId: string): Promise<string> {
    const media = await this.get(mediaId);
    return media.download_link || '';
  }

  /**
   * Delete media
   */
  async delete(mediaId: string): Promise<void> {
    await this.client.delete(`/media/${mediaId}`);
  }

  /**
   * Check media processing status
   */
  async checkStatus(mediaId: string): Promise<{ status: string; ready: boolean }> {
    const media = await this.get(mediaId);
    return {
      status: media.media_status,
      ready: media.media_status === 'READY',
    };
  }

  /**
   * Wait for media to be ready (poll until processed)
   */
  async waitForReady(mediaId: string, timeoutMs: number = 300000): Promise<Media> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds

    while (Date.now() - startTime < timeoutMs) {
      const media = await this.get(mediaId);

      if (media.media_status === 'READY') {
        return media;
      }

      if (media.media_status === 'FAILED') {
        throw new Error(`Media processing failed for ${mediaId}`);
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timeout waiting for media ${mediaId} to be ready`);
  }
}
