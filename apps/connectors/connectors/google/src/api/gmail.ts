import type { GoogleClient } from './client';
import type {
  GmailMessage,
  GmailListMessagesResponse,
  GmailLabel,
  GmailListLabelsResponse,
  GmailDraft,
  GmailListDraftsResponse,
  GmailSendParams,
} from '../types';

/**
 * Gmail API module
 * https://gmail.googleapis.com
 */
export class GmailApi {
  constructor(private readonly client: GoogleClient) {}

  // ============================================
  // Messages
  // ============================================

  /**
   * List messages in the user's mailbox
   */
  async listMessages(options?: {
    maxResults?: number;
    pageToken?: string;
    q?: string;
    labelIds?: string[];
    includeSpamTrash?: boolean;
  }): Promise<GmailListMessagesResponse> {
    return this.client.gmailGet<GmailListMessagesResponse>('/gmail/v1/users/me/messages', {
      maxResults: options?.maxResults,
      pageToken: options?.pageToken,
      q: options?.q,
      labelIds: options?.labelIds?.join(','),
      includeSpamTrash: options?.includeSpamTrash,
    });
  }

  /**
   * Get a specific message by ID
   */
  async getMessage(id: string, options?: {
    format?: 'minimal' | 'full' | 'raw' | 'metadata';
    metadataHeaders?: string[];
  }): Promise<GmailMessage> {
    return this.client.gmailGet<GmailMessage>(`/gmail/v1/users/me/messages/${id}`, {
      format: options?.format || 'full',
      metadataHeaders: options?.metadataHeaders?.join(','),
    });
  }

  /**
   * Send an email message
   */
  async sendMessage(params: GmailSendParams): Promise<GmailMessage> {
    const raw = this.createRawMessage(params);
    return this.client.gmailPost<GmailMessage>('/gmail/v1/users/me/messages/send', {
      raw,
    });
  }

  /**
   * Delete a message permanently
   */
  async deleteMessage(id: string): Promise<void> {
    await this.client.gmailDelete(`/gmail/v1/users/me/messages/${id}`);
  }

  /**
   * Move a message to trash
   */
  async trashMessage(id: string): Promise<GmailMessage> {
    return this.client.gmailPost<GmailMessage>(`/gmail/v1/users/me/messages/${id}/trash`);
  }

  /**
   * Remove a message from trash
   */
  async untrashMessage(id: string): Promise<GmailMessage> {
    return this.client.gmailPost<GmailMessage>(`/gmail/v1/users/me/messages/${id}/untrash`);
  }

  /**
   * Modify message labels
   */
  async modifyMessage(id: string, options: {
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }): Promise<GmailMessage> {
    return this.client.gmailPost<GmailMessage>(`/gmail/v1/users/me/messages/${id}/modify`, {
      addLabelIds: options.addLabelIds,
      removeLabelIds: options.removeLabelIds,
    });
  }

  // ============================================
  // Labels
  // ============================================

  /**
   * List all labels
   */
  async listLabels(): Promise<GmailListLabelsResponse> {
    return this.client.gmailGet<GmailListLabelsResponse>('/gmail/v1/users/me/labels');
  }

  /**
   * Get a specific label
   */
  async getLabel(id: string): Promise<GmailLabel> {
    return this.client.gmailGet<GmailLabel>(`/gmail/v1/users/me/labels/${id}`);
  }

  /**
   * Create a new label
   */
  async createLabel(name: string, options?: {
    labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
    messageListVisibility?: 'show' | 'hide';
    textColor?: string;
    backgroundColor?: string;
  }): Promise<GmailLabel> {
    const body: Record<string, unknown> = {
      name,
      labelListVisibility: options?.labelListVisibility || 'labelShow',
      messageListVisibility: options?.messageListVisibility || 'show',
    };

    if (options?.textColor || options?.backgroundColor) {
      body.color = {
        textColor: options?.textColor,
        backgroundColor: options?.backgroundColor,
      };
    }

    return this.client.gmailPost<GmailLabel>('/gmail/v1/users/me/labels', body);
  }

  /**
   * Delete a label
   */
  async deleteLabel(id: string): Promise<void> {
    await this.client.gmailDelete(`/gmail/v1/users/me/labels/${id}`);
  }

  /**
   * Update a label
   */
  async updateLabel(id: string, options: {
    name?: string;
    labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
    messageListVisibility?: 'show' | 'hide';
    textColor?: string;
    backgroundColor?: string;
  }): Promise<GmailLabel> {
    const body: Record<string, unknown> = {};

    if (options.name) body.name = options.name;
    if (options.labelListVisibility) body.labelListVisibility = options.labelListVisibility;
    if (options.messageListVisibility) body.messageListVisibility = options.messageListVisibility;

    if (options.textColor || options.backgroundColor) {
      body.color = {
        textColor: options.textColor,
        backgroundColor: options.backgroundColor,
      };
    }

    return this.client.request<GmailLabel>('gmail', `/gmail/v1/users/me/labels/${id}`, {
      method: 'PATCH',
      body,
    });
  }

  // ============================================
  // Drafts
  // ============================================

  /**
   * List drafts
   */
  async listDrafts(options?: {
    maxResults?: number;
    pageToken?: string;
    q?: string;
    includeSpamTrash?: boolean;
  }): Promise<GmailListDraftsResponse> {
    return this.client.gmailGet<GmailListDraftsResponse>('/gmail/v1/users/me/drafts', {
      maxResults: options?.maxResults,
      pageToken: options?.pageToken,
      q: options?.q,
      includeSpamTrash: options?.includeSpamTrash,
    });
  }

  /**
   * Get a draft
   */
  async getDraft(id: string, options?: {
    format?: 'minimal' | 'full' | 'raw' | 'metadata';
  }): Promise<GmailDraft> {
    return this.client.gmailGet<GmailDraft>(`/gmail/v1/users/me/drafts/${id}`, {
      format: options?.format || 'full',
    });
  }

  /**
   * Create a draft
   */
  async createDraft(params: GmailSendParams): Promise<GmailDraft> {
    const raw = this.createRawMessage(params);
    return this.client.gmailPost<GmailDraft>('/gmail/v1/users/me/drafts', {
      message: { raw },
    });
  }

  /**
   * Update a draft
   */
  async updateDraft(id: string, params: GmailSendParams): Promise<GmailDraft> {
    const raw = this.createRawMessage(params);
    return this.client.request<GmailDraft>('gmail', `/gmail/v1/users/me/drafts/${id}`, {
      method: 'PUT',
      body: {
        message: { raw },
      },
    });
  }

  /**
   * Delete a draft
   */
  async deleteDraft(id: string): Promise<void> {
    await this.client.gmailDelete(`/gmail/v1/users/me/drafts/${id}`);
  }

  /**
   * Send a draft
   */
  async sendDraft(id: string): Promise<GmailMessage> {
    return this.client.gmailPost<GmailMessage>('/gmail/v1/users/me/drafts/send', {
      id,
    });
  }

  // ============================================
  // Helpers
  // ============================================

  /**
   * Create a base64url-encoded raw email message
   */
  private createRawMessage(params: GmailSendParams): string {
    const headers = [
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
    ];

    if (params.cc) {
      headers.push(`Cc: ${params.cc}`);
    }

    if (params.bcc) {
      headers.push(`Bcc: ${params.bcc}`);
    }

    if (params.isHtml) {
      headers.push('Content-Type: text/html; charset=utf-8');
    } else {
      headers.push('Content-Type: text/plain; charset=utf-8');
    }

    const message = `${headers.join('\r\n')}\r\n\r\n${params.body}`;

    // Base64url encode (URL-safe base64)
    const encoded = Buffer.from(message).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return encoded;
  }

  /**
   * Extract headers from a message
   */
  extractHeaders(message: GmailMessage): Record<string, string> {
    const headers: Record<string, string> = {};
    if (message.payload?.headers) {
      for (const header of message.payload.headers) {
        headers[header.name.toLowerCase()] = header.value;
      }
    }
    return headers;
  }

  /**
   * Get the plain text body from a message
   */
  extractBody(message: GmailMessage): string {
    const payload = message.payload;
    if (!payload) return '';

    // Check if the body is directly in payload
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    // Search through parts
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        // Recursively check nested parts
        if (part.parts) {
          for (const subPart of part.parts) {
            if (subPart.mimeType === 'text/plain' && subPart.body?.data) {
              return Buffer.from(subPart.body.data, 'base64').toString('utf-8');
            }
          }
        }
      }

      // If no plain text, try HTML
      for (const part of payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
    }

    return '';
  }
}
