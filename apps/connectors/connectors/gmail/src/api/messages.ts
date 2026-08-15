import type { GmailClient } from './client';
import type {
  GmailMessage,
  MessagePart,
  MessageListResponse,
  ListMessagesOptions,
  SendMessageOptions,
} from '../types';
import { getFormattedSender, getUserEmail } from '../utils/config';

/**
 * Encode a string for email headers using RFC 2047 MIME encoded-word syntax
 * Only encodes if non-ASCII characters are present
 */
function encodeHeaderValue(value: string): string {
  // Check if encoding is needed (non-ASCII characters present)
  if (!/[^\x00-\x7F]/.test(value)) {
    return value;
  }
  // Use Base64 encoding for UTF-8
  const encoded = Buffer.from(value, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

/**
 * Strip HTML tags to create plain text version
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
import { formatEmailWithName } from '../utils/contacts';
import { markdownToHtml, wrapInEmailTemplate, looksLikeMarkdown } from '../utils/markdown';
import { loadSettings, shouldAppendSignature, getSignature } from '../utils/settings';

export interface ReplyOptions {
  body: string;
  isHtml?: boolean;
  cc?: string | string[];
  bcc?: string | string[];
}

export class MessagesApi {
  private client: GmailClient;

  constructor(client: GmailClient) {
    this.client = client;
  }

  /**
   * List messages in the user's mailbox
   */
  async list(options: ListMessagesOptions = {}): Promise<MessageListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      maxResults: options.maxResults || 10,
      pageToken: options.pageToken,
      q: options.q,
      includeSpamTrash: options.includeSpamTrash,
    };

    if (options.labelIds && options.labelIds.length > 0) {
      params.labelIds = options.labelIds.join(',');
    }

    return this.client.get<MessageListResponse>(
      `/users/${this.client.getUserId()}/messages`,
      params
    );
  }

  /**
   * Get a specific message by ID
   */
  async get(messageId: string, format: 'full' | 'metadata' | 'minimal' | 'raw' = 'full'): Promise<GmailMessage> {
    return this.client.get<GmailMessage>(
      `/users/${this.client.getUserId()}/messages/${messageId}`,
      { format }
    );
  }

  /**
   * Send a new email message
   */
  async send(options: SendMessageOptions): Promise<GmailMessage> {
    const message = this.buildRawMessage(options);
    const encodedMessage = Buffer.from(message).toString('base64url');

    const body: Record<string, unknown> = {
      raw: encodedMessage,
    };

    if (options.threadId) {
      body.threadId = options.threadId;
    }

    return this.client.post<GmailMessage>(
      `/users/${this.client.getUserId()}/messages/send`,
      body
    );
  }

  /**
   * Reply to a message in the same thread
   */
  async reply(messageId: string, options: ReplyOptions): Promise<GmailMessage> {
    // Get the original message to extract thread info and headers
    const original = await this.get(messageId, 'full');
    const headers = original.payload?.headers || [];

    const getHeader = (name: string) =>
      headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const originalFrom = getHeader('From');
    const originalTo = getHeader('To');
    const originalSubject = getHeader('Subject');
    const originalMessageId = getHeader('Message-ID') || getHeader('Message-Id');
    const originalReferences = getHeader('References');

    // Determine who to reply to
    const myEmail = getUserEmail();
    let replyTo = originalFrom;

    // If we sent the original, reply to the original recipient
    if (originalFrom.includes(myEmail || '')) {
      replyTo = originalTo;
    }

    // Build references header (for proper threading)
    let references = originalReferences
      ? `${originalReferences} ${originalMessageId}`
      : originalMessageId;

    // Build subject (keep original, don't add Re: if already there)
    let subject = originalSubject;
    if (!subject.toLowerCase().startsWith('re:')) {
      subject = `Re: ${subject}`;
    }

    const message = this.buildRawMessage({
      to: replyTo,
      cc: options.cc,
      bcc: options.bcc,
      subject,
      body: options.body,
      isHtml: options.isHtml,
      threadId: original.threadId,
      inReplyTo: originalMessageId,
      references,
      isReply: true,
    });

    const encodedMessage = Buffer.from(message).toString('base64url');

    return this.client.post<GmailMessage>(
      `/users/${this.client.getUserId()}/messages/send`,
      {
        raw: encodedMessage,
        threadId: original.threadId,
      }
    );
  }

  /**
   * Move a message to trash
   */
  async trash(messageId: string): Promise<GmailMessage> {
    return this.client.post<GmailMessage>(
      `/users/${this.client.getUserId()}/messages/${messageId}/trash`
    );
  }

  /**
   * Remove a message from trash
   */
  async untrash(messageId: string): Promise<GmailMessage> {
    return this.client.post<GmailMessage>(
      `/users/${this.client.getUserId()}/messages/${messageId}/untrash`
    );
  }

  /**
   * Permanently delete a message
   */
  async delete(messageId: string): Promise<void> {
    await this.client.delete(
      `/users/${this.client.getUserId()}/messages/${messageId}`
    );
  }

  /**
   * Modify message labels
   */
  async modify(
    messageId: string,
    addLabelIds?: string[],
    removeLabelIds?: string[]
  ): Promise<GmailMessage> {
    return this.client.post<GmailMessage>(
      `/users/${this.client.getUserId()}/messages/${messageId}/modify`,
      {
        addLabelIds: addLabelIds || [],
        removeLabelIds: removeLabelIds || [],
      }
    );
  }

  /**
   * Add a label to a message
   */
  async addLabel(messageId: string, labelId: string): Promise<GmailMessage> {
    return this.modify(messageId, [labelId], undefined);
  }

  /**
   * Remove a label from a message
   */
  async removeLabel(messageId: string, labelId: string): Promise<GmailMessage> {
    return this.modify(messageId, undefined, [labelId]);
  }

  /**
   * Add multiple labels to a message
   */
  async addLabels(messageId: string, labelIds: string[]): Promise<GmailMessage> {
    return this.modify(messageId, labelIds, undefined);
  }

  /**
   * Remove multiple labels from a message
   */
  async removeLabels(messageId: string, labelIds: string[]): Promise<GmailMessage> {
    return this.modify(messageId, undefined, labelIds);
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<GmailMessage> {
    return this.modify(messageId, undefined, ['UNREAD']);
  }

  /**
   * Mark a message as unread
   */
  async markAsUnread(messageId: string): Promise<GmailMessage> {
    return this.modify(messageId, ['UNREAD']);
  }

  /**
   * Star a message
   */
  async star(messageId: string): Promise<GmailMessage> {
    return this.modify(messageId, ['STARRED']);
  }

  /**
   * Unstar a message
   */
  async unstar(messageId: string): Promise<GmailMessage> {
    return this.modify(messageId, undefined, ['STARRED']);
  }

  /**
   * Archive a message (remove from INBOX)
   */
  async archive(messageId: string): Promise<GmailMessage> {
    return this.modify(messageId, undefined, ['INBOX']);
  }

  /**
   * Build RFC 2822 formatted message
   */
  private buildRawMessage(options: SendMessageOptions & { inReplyTo?: string; references?: string; isReply?: boolean }): string {
    const settings = loadSettings();
    const isReply = options.isReply || !!options.inReplyTo;

    // Format To addresses with contact names
    const formatAddresses = (addresses: string | string[]): string => {
      const addrs = Array.isArray(addresses) ? addresses : [addresses];
      return addrs.map(addr => {
        // If already formatted with name, keep it
        if (addr.includes('<') && addr.includes('>')) {
          return addr;
        }
        return formatEmailWithName(addr);
      }).join(', ');
    };

    const to = formatAddresses(options.to);
    const cc = options.cc ? formatAddresses(options.cc) : '';
    const bcc = options.bcc ? formatAddresses(options.bcc) : '';

    // Process body: markdown conversion and signature
    let body = options.body;
    let isHtml = options.isHtml || false;

    // Auto-detect and convert markdown if enabled
    if (settings.markdownEnabled && !isHtml && looksLikeMarkdown(body)) {
      body = markdownToHtml(body);
      isHtml = true;
    }

    // Append signature (only for new emails by default, configurable for replies)
    if (shouldAppendSignature(isReply)) {
      const signature = getSignature();
      if (signature) {
        // Gmail signatures are HTML, so convert body to HTML if needed
        if (!isHtml) {
          body = body.replace(/\n/g, '<br>');
          isHtml = true;
        }
        body += `<br><br>${signature}`;
      }
    }

    // Get formatted sender with display name
    let from: string;
    try {
      from = getFormattedSender();
    } catch {
      from = getUserEmail() || '';
    }

    let message = '';
    message += `From: ${from}\r\n`;
    message += `To: ${to}\r\n`;
    if (cc) message += `Cc: ${cc}\r\n`;
    if (bcc) message += `Bcc: ${bcc}\r\n`;
    message += `Subject: ${encodeHeaderValue(options.subject)}\r\n`;

    // Add threading headers for replies
    if (options.inReplyTo) {
      message += `In-Reply-To: ${options.inReplyTo}\r\n`;
    }
    if (options.references) {
      message += `References: ${options.references}\r\n`;
    }

    message += `MIME-Version: 1.0\r\n`;

    const mixedBoundary = `mixed_${Date.now()}`;
    const altBoundary = `alt_${Date.now()}`;

    if (options.attachments && options.attachments.length > 0) {
      // Multipart/mixed for attachments
      message += `Content-Type: multipart/mixed; boundary="${mixedBoundary}"\r\n\r\n`;
      message += `--${mixedBoundary}\r\n`;

      if (isHtml) {
        // Nested multipart/alternative for HTML with plain text fallback
        const htmlBody = wrapInEmailTemplate(body);
        const plainBody = htmlToPlainText(body);
        message += `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n`;
        message += `--${altBoundary}\r\n`;
        message += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`;
        message += `${plainBody}\r\n`;
        message += `--${altBoundary}\r\n`;
        message += `Content-Type: text/html; charset="UTF-8"\r\n\r\n`;
        message += `${htmlBody}\r\n`;
        message += `--${altBoundary}--\r\n`;
      } else {
        message += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`;
        message += `${body}\r\n`;
      }

      for (const attachment of options.attachments) {
        message += `--${mixedBoundary}\r\n`;
        message += `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\n`;
        message += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
        message += `Content-Transfer-Encoding: base64\r\n\r\n`;
        message += `${attachment.data}\r\n`;
      }

      message += `--${mixedBoundary}--`;
    } else if (isHtml) {
      // Multipart/alternative for HTML with plain text fallback
      const htmlBody = wrapInEmailTemplate(body);
      const plainBody = htmlToPlainText(body);
      message += `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n`;
      message += `--${altBoundary}\r\n`;
      message += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`;
      message += `${plainBody}\r\n`;
      message += `--${altBoundary}\r\n`;
      message += `Content-Type: text/html; charset="UTF-8"\r\n\r\n`;
      message += `${htmlBody}\r\n`;
      message += `--${altBoundary}--`;
    } else {
      message += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`;
      message += body;
    }

    return message;
  }

  /**
   * Extract body content from a message
   * @param message The Gmail message to extract body from
   * @param preferHtml Whether to prefer HTML content over plain text
   * @returns The body content as a string
   */
  extractBody(message: GmailMessage, preferHtml: boolean = false): string {
    if (!message.payload) return '';

    const targetType = preferHtml ? 'text/html' : 'text/plain';

    // Helper to check MIME type (handles charset params like "text/html; charset=utf-8")
    const getBaseMime = (mimeType: string | undefined): string => {
      if (!mimeType) return '';
      return mimeType.split(';')[0].trim().toLowerCase();
    };

    // Collect all text parts from the message structure
    const collectTextParts = (part: MessagePart, results: Array<{mimeType: string, data: string}> = []): Array<{mimeType: string, data: string}> => {
      if (part.body?.data && part.mimeType) {
        const baseMime = getBaseMime(part.mimeType);
        if (baseMime.startsWith('text/')) {
          results.push({
            mimeType: baseMime,
            data: Buffer.from(part.body.data, 'base64url').toString('utf-8')
          });
        }
      }
      if (part.parts) {
        for (const p of part.parts) {
          collectTextParts(p, results);
        }
      }
      return results;
    };

    const textParts = collectTextParts(message.payload);

    // First, try to find exact target type
    const exactMatch = textParts.find(p => p.mimeType === targetType);
    if (exactMatch) {
      return exactMatch.data;
    }

    // Fallback: use alternative text type
    const altMatch = textParts.find(p => p.mimeType.startsWith('text/'));
    return altMatch?.data || '';
  }

  /**
   * Extract inline images from a message (for multipart/related emails)
   * @param message The Gmail message to extract inline images from
   * @returns Array of inline images with Content-ID and data
   */
  extractInlineImages(message: GmailMessage): Array<{contentId: string, mimeType: string, data: string}> {
    if (!message.payload) return [];

    const images: Array<{contentId: string, mimeType: string, data: string}> = [];

    const collectImages = (part: MessagePart): void => {
      if (part.body?.data && part.mimeType?.startsWith('image/')) {
        const contentIdHeader = part.headers?.find(
          h => h.name.toLowerCase() === 'content-id'
        );
        if (contentIdHeader) {
          // Content-ID is typically wrapped in angle brackets: <image001.png@01D12345.67890ABC>
          const contentId = contentIdHeader.value.replace(/^<|>$/g, '');
          images.push({
            contentId,
            mimeType: part.mimeType,
            data: part.body.data
          });
        }
      }
      if (part.parts) {
        for (const p of part.parts) {
          collectImages(p);
        }
      }
    };

    collectImages(message.payload);
    return images;
  }

  /**
   * Get message structure for debugging
   * @param message The Gmail message to analyze
   * @returns A tree structure showing the MIME parts
   */
  getMessageStructure(message: GmailMessage): object {
    if (!message.payload) return {};

    const buildStructure = (part: MessagePart, depth: number = 0): object => {
      const result: Record<string, unknown> = {
        mimeType: part.mimeType,
        size: part.body?.size || 0,
        hasData: !!part.body?.data,
        hasAttachmentId: !!part.body?.attachmentId,
      };

      if (part.filename) {
        result.filename = part.filename;
      }

      // Include Content-ID for inline images
      const contentIdHeader = part.headers?.find(
        h => h.name.toLowerCase() === 'content-id'
      );
      if (contentIdHeader) {
        result.contentId = contentIdHeader.value;
      }

      if (part.parts && part.parts.length > 0) {
        result.parts = part.parts.map(p => buildStructure(p, depth + 1));
      }

      return result;
    };

    return buildStructure(message.payload);
  }
}
