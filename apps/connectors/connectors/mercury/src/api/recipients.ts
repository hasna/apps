import type { MercuryClient } from './client';
import type {
  Recipient,
  RecipientListResponse,
  RecipientCreateParams,
  RecipientUpdateParams,
} from '../types';

/**
 * Mercury Recipients API
 * Manage payment recipients
 */
export class RecipientsApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * List all recipients
   */
  async list(params?: { limit?: number; offset?: number; status?: 'active' | 'archived' }): Promise<RecipientListResponse> {
    return this.client.get<RecipientListResponse>('/recipients', {
      limit: params?.limit,
      offset: params?.offset,
      status: params?.status,
    });
  }

  /**
   * Get a single recipient by ID
   */
  async get(recipientId: string): Promise<Recipient> {
    return this.client.get<Recipient>(`/recipient/${recipientId}`);
  }

  /**
   * Create a new recipient
   */
  async create(params: RecipientCreateParams): Promise<Recipient> {
    return this.client.post<Recipient>('/recipients', params);
  }

  /**
   * Update a recipient
   */
  async update(recipientId: string, params: RecipientUpdateParams): Promise<Recipient> {
    return this.client.post<Recipient>(`/recipient/${recipientId}`, params);
  }

  /**
   * Archive a recipient
   */
  async archive(recipientId: string): Promise<Recipient> {
    return this.client.post<Recipient>(`/recipient/${recipientId}`, { status: 'archived' });
  }

  /**
   * Delete a recipient
   */
  async delete(recipientId: string): Promise<void> {
    await this.client.delete(`/recipient/${recipientId}`);
  }

  /**
   * List attachments for a recipient
   */
  async listAttachments(recipientId: string): Promise<{ attachments: Array<{ id: string; fileName: string; fileType: string; downloadUrl: string }> }> {
    return this.client.get<{ attachments: Array<{ id: string; fileName: string; fileType: string; downloadUrl: string }> }>(
      `/recipient/${recipientId}/attachments`
    );
  }

  /**
   * Upload an attachment to a recipient (multipart/form-data)
   * Note: For tax form attachments - supports PDF, images (PNG, JPG, GIF), and common document formats
   */
  async uploadAttachment(
    recipientId: string,
    file: { fileName: string; fileType: string; content: string }
  ): Promise<{ id: string; fileName: string; fileType: string; downloadUrl: string }> {
    return this.client.post<{ id: string; fileName: string; fileType: string; downloadUrl: string }>(
      `/recipient/${recipientId}/attachments`,
      file
    );
  }
}
