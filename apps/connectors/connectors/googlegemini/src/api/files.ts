import type { GeminiClient } from './client';
import type { UploadedFile, ListFilesResponse } from '../types';

/**
 * Files API
 */
export class FilesApi {
  constructor(private client: GeminiClient) {}

  /**
   * Upload a file
   */
  async upload(
    filePath: string,
    options?: { mimeType?: string; displayName?: string }
  ): Promise<UploadedFile> {
    const fs = await import('fs');
    const path = await import('path');

    const fileContent = fs.readFileSync(filePath);
    const fileName = options?.displayName || path.basename(filePath);

    // Determine MIME type
    let mimeType = options?.mimeType;
    if (!mimeType) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        // Images
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        // Audio
        '.mp3': 'audio/mp3',
        '.wav': 'audio/wav',
        '.aiff': 'audio/aiff',
        '.aac': 'audio/aac',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        // Video
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        // Documents
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.json': 'application/json',
        '.csv': 'text/csv',
      };
      mimeType = mimeTypes[ext] || 'application/octet-stream';
    }

    const result = await this.client.uploadFile(filePath, mimeType, fileName);

    // Wait for file to be processed
    return this.waitForProcessing(result.file.name);
  }

  /**
   * List uploaded files
   */
  async list(pageSize?: number, pageToken?: string): Promise<ListFilesResponse> {
    return this.client.get<ListFilesResponse>('/files', {
      pageSize,
      pageToken,
    });
  }

  /**
   * Get file info
   */
  async get(fileName: string): Promise<UploadedFile> {
    // fileName format: files/xxx
    const name = fileName.startsWith('files/') ? fileName : `files/${fileName}`;
    return this.client.get<UploadedFile>(`/${name}`);
  }

  /**
   * Delete a file
   */
  async delete(fileName: string): Promise<void> {
    const name = fileName.startsWith('files/') ? fileName : `files/${fileName}`;
    await this.client.delete(`/${name}`);
  }

  /**
   * Wait for file processing to complete
   */
  async waitForProcessing(
    fileName: string,
    pollInterval = 2000,
    maxWait = 120000
  ): Promise<UploadedFile> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const file = await this.get(fileName);

      if (file.state === 'ACTIVE') {
        return file;
      }

      if (file.state === 'FAILED') {
        throw new Error(`File processing failed: ${file.error?.message || 'Unknown error'}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error('File processing timed out');
  }

  /**
   * Upload multiple files
   */
  async uploadMultiple(
    filePaths: string[],
    options?: { mimeType?: string }
  ): Promise<UploadedFile[]> {
    const results: UploadedFile[] = [];

    for (const filePath of filePaths) {
      const file = await this.upload(filePath, options);
      results.push(file);
    }

    return results;
  }

  /**
   * Delete all files
   */
  async deleteAll(): Promise<number> {
    let deleted = 0;
    let pageToken: string | undefined;

    do {
      const response = await this.list(100, pageToken);

      for (const file of response.files || []) {
        await this.delete(file.name);
        deleted++;
      }

      pageToken = response.nextPageToken;
    } while (pageToken);

    return deleted;
  }
}
