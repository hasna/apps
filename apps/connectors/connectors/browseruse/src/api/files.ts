import type { BrowserUseClient } from './client';
import type { PresignedUrl, UploadFileParams } from '../types';

/**
 * Files API
 */
export class FilesApi {
  constructor(private client: BrowserUseClient) {}

  /**
   * Get presigned URL for uploading a file to an agent session
   */
  async getAgentSessionUploadUrl(sessionId: string, params: UploadFileParams): Promise<PresignedUrl> {
    return this.client.post<PresignedUrl>(`/v2/sessions/${sessionId}/files/upload`, {
      file_name: params.fileName,
      content_type: params.contentType,
    });
  }

  /**
   * Get presigned URL for uploading a file to a browser session
   */
  async getBrowserSessionUploadUrl(browserId: string, params: UploadFileParams): Promise<PresignedUrl> {
    return this.client.post<PresignedUrl>(`/v2/browsers/${browserId}/files/upload`, {
      file_name: params.fileName,
      content_type: params.contentType,
    });
  }

  /**
   * Get presigned URL for downloading a task output file
   */
  async getTaskOutputUrl(taskId: string, fileId: string): Promise<PresignedUrl> {
    return this.client.get<PresignedUrl>(`/v2/tasks/${taskId}/files/${fileId}`);
  }

  /**
   * Upload a file using a presigned URL
   */
  async uploadFile(presignedUrl: string, data: Uint8Array | Buffer | string, contentType?: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    const response = await fetch(presignedUrl, {
      method: 'PUT',
      headers,
      body: data,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload file: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Download a file from a presigned URL
   */
  async downloadFile(presignedUrl: string): Promise<Uint8Array> {
    const response = await fetch(presignedUrl);

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }
}
