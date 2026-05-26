import type { PandaDocClient } from './client';
import type {
  Document,
  DocumentListItem,
  DocumentListResponse,
  DocumentCreateParams,
  DocumentSendParams,
  DocumentStatus,
  Field,
  Recipient,
  DocumentAttachment,
} from '../types';

export interface DocumentListOptions {
  q?: string; // Search query
  status?: DocumentStatus | DocumentStatus[];
  tag?: string;
  count?: number;
  page?: number;
  order_by?: 'name' | 'date_created' | 'date_modified' | 'date_completed';
  folder_uuid?: string;
  template_id?: string;
  created_from?: string; // ISO date
  created_to?: string;   // ISO date
  modified_from?: string;
  modified_to?: string;
  completed_from?: string;
  completed_to?: string;
  deleted?: boolean;
}

export interface DocumentDetailsOptions {
  include_links?: boolean;
}

/**
 * Documents API - Manage PandaDoc documents
 */
export class DocumentsApi {
  constructor(private readonly client: PandaDocClient) {}

  /**
   * List documents with optional filtering
   */
  async list(options?: DocumentListOptions): Promise<DocumentListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};

    if (options) {
      if (options.q) params.q = options.q;
      if (options.tag) params.tag = options.tag;
      if (options.count) params.count = options.count;
      if (options.page) params.page = options.page;
      if (options.order_by) params.order_by = options.order_by;
      if (options.folder_uuid) params.folder_uuid = options.folder_uuid;
      if (options.template_id) params.template_id = options.template_id;
      if (options.created_from) params.created_from = options.created_from;
      if (options.created_to) params.created_to = options.created_to;
      if (options.modified_from) params.modified_from = options.modified_from;
      if (options.modified_to) params.modified_to = options.modified_to;
      if (options.completed_from) params.completed_from = options.completed_from;
      if (options.completed_to) params.completed_to = options.completed_to;
      if (options.deleted !== undefined) params.deleted = options.deleted;

      // Handle status array
      if (options.status) {
        if (Array.isArray(options.status)) {
          params.status = options.status.join(',');
        } else {
          params.status = options.status;
        }
      }
    }

    return this.client.get<DocumentListResponse>('/documents', params);
  }

  /**
   * Get document details by ID
   */
  async get(id: string, options?: DocumentDetailsOptions): Promise<Document> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options?.include_links) params.include_links = options.include_links;
    return this.client.get<Document>(`/documents/${id}/details`, params);
  }

  /**
   * Get document status
   */
  async status(id: string): Promise<{ id: string; status: DocumentStatus; name: string }> {
    return this.client.get<{ id: string; status: DocumentStatus; name: string }>(`/documents/${id}`);
  }

  /**
   * Create a new document
   */
  async create(params: DocumentCreateParams): Promise<{ id: string; uuid: string; status: DocumentStatus; name: string }> {
    return this.client.post<{ id: string; uuid: string; status: DocumentStatus; name: string }>('/documents', params);
  }

  /**
   * Create a document from a PDF URL
   */
  async createFromUrl(name: string, url: string, options?: Omit<DocumentCreateParams, 'name' | 'url'>): Promise<{ id: string; uuid: string; status: DocumentStatus; name: string }> {
    return this.create({
      name,
      url,
      parse_form_fields: true,
      ...options,
    });
  }

  /**
   * Send a document for signing
   */
  async send(id: string, params?: DocumentSendParams): Promise<{ id: string; status: DocumentStatus }> {
    return this.client.post<{ id: string; status: DocumentStatus }>(`/documents/${id}/send`, params || {});
  }

  /**
   * Download document as PDF
   */
  async download(id: string, options?: { separate_files?: boolean }): Promise<Response> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options?.separate_files) params.separate_files = options.separate_files;
    return this.client.getRaw(`/documents/${id}/download`, params);
  }

  /**
   * Download protected document as PDF (requires re-authentication)
   */
  async downloadProtected(id: string): Promise<Response> {
    return this.client.getRaw(`/documents/${id}/download-protected`);
  }

  /**
   * Delete a document (move to trash)
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/documents/${id}`);
  }

  /**
   * Permanently delete a document
   */
  async deletePermanently(id: string): Promise<void> {
    await this.client.delete(`/documents/${id}`, { force: true });
  }

  /**
   * Move document to a folder
   */
  async move(id: string, folderUuid: string): Promise<void> {
    await this.client.post(`/documents/${id}/move`, { folder_uuid: folderUuid });
  }

  /**
   * Get document recipients
   */
  async getRecipients(id: string): Promise<{ recipients: Recipient[] }> {
    return this.client.get<{ recipients: Recipient[] }>(`/documents/${id}/recipients`);
  }

  /**
   * Add recipient to document
   */
  async addRecipient(id: string, recipient: Recipient): Promise<Recipient> {
    return this.client.post<Recipient>(`/documents/${id}/recipients`, recipient);
  }

  /**
   * Delete recipient from document
   */
  async deleteRecipient(documentId: string, recipientId: string): Promise<void> {
    await this.client.delete(`/documents/${documentId}/recipients/${recipientId}`);
  }

  /**
   * Get document fields
   */
  async getFields(id: string): Promise<{ fields: Field[] }> {
    return this.client.get<{ fields: Field[] }>(`/documents/${id}/fields`);
  }

  /**
   * Update document fields
   */
  async updateFields(id: string, fields: Record<string, { value: unknown }>): Promise<{ fields: Field[] }> {
    return this.client.patch<{ fields: Field[] }>(`/documents/${id}/fields`, { fields });
  }

  /**
   * Get document attachments
   */
  async getAttachments(id: string): Promise<DocumentAttachment[]> {
    return this.client.get<DocumentAttachment[]>(`/documents/${id}/attachments`);
  }

  /**
   * Add attachment to document
   */
  async addAttachment(documentId: string, name: string, fileContent: string, source: 'file' | 'url' = 'file'): Promise<DocumentAttachment> {
    return this.client.post<DocumentAttachment>(`/documents/${documentId}/attachments`, {
      name,
      file: fileContent,
      source,
    });
  }

  /**
   * Delete attachment from document
   */
  async deleteAttachment(documentId: string, attachmentUuid: string): Promise<void> {
    await this.client.delete(`/documents/${documentId}/attachments/${attachmentUuid}`);
  }

  /**
   * Download attachment
   */
  async downloadAttachment(documentId: string, attachmentUuid: string): Promise<Response> {
    return this.client.getRaw(`/documents/${documentId}/attachments/${attachmentUuid}/download`);
  }

  /**
   * Get session for linked object (iframe embed)
   */
  async createSession(id: string, recipient: { email: string }, options?: { lifetime?: number }): Promise<{ id: string; expires_at: string }> {
    return this.client.post<{ id: string; expires_at: string }>(`/documents/${id}/session`, {
      recipient,
      lifetime: options?.lifetime,
    });
  }

  /**
   * Get sharing link
   */
  async getSharingLink(id: string, recipientId: string, options?: { lifetime?: number }): Promise<{ link: string; expires_at: string }> {
    return this.client.post<{ link: string; expires_at: string }>(`/documents/${id}/send-link`, {
      recipient: recipientId,
      lifetime: options?.lifetime,
    });
  }

  /**
   * Transfer document ownership
   */
  async transferOwnership(id: string, membershipId: string): Promise<void> {
    await this.client.post(`/documents/${id}/ownership`, { membership_id: membershipId });
  }

  /**
   * Update document metadata
   */
  async updateMetadata(id: string, metadata: Record<string, string>): Promise<Document> {
    return this.client.patch<Document>(`/documents/${id}`, { metadata });
  }

  /**
   * Void a sent document
   */
  async void(id: string): Promise<void> {
    await this.client.post(`/documents/${id}/void`);
  }
}
