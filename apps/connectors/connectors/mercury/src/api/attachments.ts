import type { MercuryClient } from './client';

export interface Attachment {
  id: string;
  fileName: string;
  url: string; // Signed S3 download URL (expires, must be refreshed)
}

/**
 * Mercury Attachments API
 * Get attachment details and download URLs
 */
export class AttachmentsApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * Get an attachment by ID
   * Returns attachment details including a signed S3 download URL
   * Note: The URL expires, call this endpoint to get a fresh URL when needed
   */
  async get(attachmentId: string): Promise<Attachment> {
    return this.client.get<Attachment>(`/ar/attachments/${attachmentId}`);
  }
}
