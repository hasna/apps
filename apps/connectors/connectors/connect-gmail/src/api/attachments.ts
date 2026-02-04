import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { GmailClient } from './client';
import type { GmailMessage, MessagePart } from '../types';
import { getConfigDir } from '../utils/config';

export interface AttachmentInfo {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  partId: string;
}

export interface AttachmentData {
  data: string; // base64 encoded
  size: number;
}

export interface DownloadedAttachment {
  filename: string;
  path: string;
  size: number;
  mimeType: string;
}

export class AttachmentsApi {
  private client: GmailClient;

  constructor(client: GmailClient) {
    this.client = client;
  }

  /**
   * Get the attachments directory for a specific message
   */
  private getAttachmentsDir(messageId: string): string {
    const dir = join(getConfigDir(), 'attachments', messageId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Extract attachment info from a message part recursively
   */
  private extractAttachments(part: MessagePart, attachments: AttachmentInfo[] = []): AttachmentInfo[] {
    // Check if this part is an attachment
    if (part.body?.attachmentId && part.filename) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size,
        partId: part.partId,
      });
    }

    // Recursively check nested parts
    if (part.parts) {
      for (const subpart of part.parts) {
        this.extractAttachments(subpart, attachments);
      }
    }

    return attachments;
  }

  /**
   * List all attachments in a message
   */
  async list(messageId: string): Promise<AttachmentInfo[]> {
    const message = await this.client.get<GmailMessage>(
      `/users/${this.client.getUserId()}/messages/${messageId}`,
      { format: 'full' }
    );

    if (!message.payload) {
      return [];
    }

    return this.extractAttachments(message.payload);
  }

  /**
   * Get attachment data by attachment ID
   */
  async get(messageId: string, attachmentId: string): Promise<AttachmentData> {
    return this.client.get<AttachmentData>(
      `/users/${this.client.getUserId()}/messages/${messageId}/attachments/${attachmentId}`
    );
  }

  /**
   * Download a specific attachment to disk
   */
  async download(messageId: string, attachmentId: string, filename: string, mimeType: string): Promise<DownloadedAttachment> {
    const data = await this.get(messageId, attachmentId);
    const dir = this.getAttachmentsDir(messageId);
    const filepath = join(dir, filename);

    // Decode base64url to buffer
    const buffer = Buffer.from(data.data, 'base64url');
    writeFileSync(filepath, buffer);

    return {
      filename,
      path: filepath,
      size: buffer.length,
      mimeType,
    };
  }

  /**
   * Download all attachments from a message
   */
  async downloadAll(messageId: string): Promise<DownloadedAttachment[]> {
    const attachments = await this.list(messageId);
    const downloaded: DownloadedAttachment[] = [];

    for (const attachment of attachments) {
      const result = await this.download(
        messageId,
        attachment.attachmentId,
        attachment.filename,
        attachment.mimeType
      );
      downloaded.push(result);
    }

    return downloaded;
  }

  /**
   * Get the path where attachments for a message are/would be stored
   */
  getStoragePath(messageId: string): string {
    return this.getAttachmentsDir(messageId);
  }
}
