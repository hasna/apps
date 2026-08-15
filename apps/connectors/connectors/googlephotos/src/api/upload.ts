import { readFileSync } from 'fs';
import { basename, extname } from 'path';
import type { PhotosClient } from './client';
import type {
  MediaItem,
  BatchCreateMediaItemsRequest,
  BatchCreateMediaItemsResponse,
  NewMediaItem,
} from '../types';

// MIME type mapping for common image/video formats
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.raw': 'image/raw',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
  '.3gp': 'video/3gpp',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.wmv': 'video/x-ms-wmv',
};

export class UploadApi {
  constructor(private client: PhotosClient) {}

  /**
   * Get MIME type from file extension
   */
  private getMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
  }

  /**
   * Upload a single file and get an upload token
   */
  async uploadFile(filePath: string): Promise<string> {
    const data = readFileSync(filePath);
    const mimeType = this.getMimeType(filePath);
    const filename = basename(filePath);

    return this.client.uploadBytes(data, mimeType, filename);
  }

  /**
   * Upload bytes directly and get an upload token
   */
  async uploadBytes(data: Buffer | Uint8Array, mimeType: string, filename?: string): Promise<string> {
    return this.client.uploadBytes(data, mimeType, filename);
  }

  /**
   * Create media items from upload tokens
   */
  async createMediaItems(
    uploadTokens: Array<{ uploadToken: string; filename?: string; description?: string }>,
    albumId?: string
  ): Promise<BatchCreateMediaItemsResponse> {
    const newMediaItems: NewMediaItem[] = uploadTokens.map(item => ({
      description: item.description,
      simpleMediaItem: {
        fileName: item.filename,
        uploadToken: item.uploadToken,
      },
    }));

    const request: BatchCreateMediaItemsRequest = {
      newMediaItems,
    };

    if (albumId) {
      request.albumId = albumId;
    }

    return this.client.post<BatchCreateMediaItemsResponse>('/mediaItems:batchCreate', request);
  }

  /**
   * Upload a single file and create a media item
   */
  async uploadAndCreate(
    filePath: string,
    options: { description?: string; albumId?: string } = {}
  ): Promise<MediaItem | null> {
    const uploadToken = await this.uploadFile(filePath);
    const filename = basename(filePath);

    const response = await this.createMediaItems(
      [{ uploadToken, filename, description: options.description }],
      options.albumId
    );

    const result = response.newMediaItemResults[0];
    if (result.status?.code && result.status.code !== 0) {
      throw new Error(`Failed to create media item: ${result.status.message}`);
    }

    return result.mediaItem || null;
  }

  /**
   * Upload multiple files and create media items
   */
  async uploadMultiple(
    filePaths: string[],
    options: { albumId?: string; onProgress?: (completed: number, total: number, filename: string) => void } = {}
  ): Promise<BatchCreateMediaItemsResponse> {
    const uploadTokens: Array<{ uploadToken: string; filename: string }> = [];

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      const filename = basename(filePath);

      if (options.onProgress) {
        options.onProgress(i, filePaths.length, filename);
      }

      const uploadToken = await this.uploadFile(filePath);
      uploadTokens.push({ uploadToken, filename });
    }

    if (options.onProgress) {
      options.onProgress(filePaths.length, filePaths.length, 'Creating media items...');
    }

    return this.createMediaItems(uploadTokens, options.albumId);
  }

  /**
   * Upload files from a directory
   */
  async uploadDirectory(
    dirPath: string,
    options: {
      albumId?: string;
      recursive?: boolean;
      extensions?: string[];
      onProgress?: (completed: number, total: number, filename: string) => void;
    } = {}
  ): Promise<BatchCreateMediaItemsResponse> {
    const { readdirSync, statSync } = await import('fs');
    const { join } = await import('path');

    const supportedExtensions = options.extensions || Object.keys(MIME_TYPES);
    const files: string[] = [];

    const collectFiles = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory() && options.recursive) {
          collectFiles(fullPath);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (supportedExtensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    };

    collectFiles(dirPath);

    if (files.length === 0) {
      return { newMediaItemResults: [] };
    }

    return this.uploadMultiple(files, {
      albumId: options.albumId,
      onProgress: options.onProgress,
    });
  }

  /**
   * Get supported file extensions
   */
  getSupportedExtensions(): string[] {
    return Object.keys(MIME_TYPES);
  }

  /**
   * Check if a file extension is supported
   */
  isSupported(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return ext in MIME_TYPES;
  }
}
