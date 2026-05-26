import type { GmailClient } from './client';
import type { GmailMessage, GmailDraft, SendMessageOptions } from '../types';
import { getFormattedSender, getUserEmail } from '../utils/config';
import { formatEmailWithName } from '../utils/contacts';
import { markdownToHtml, wrapInEmailTemplate, looksLikeMarkdown } from '../utils/markdown';
import { loadSettings, shouldAppendSignature, getSignature } from '../utils/settings';

/**
 * Encode a string for email headers using RFC 2047 MIME encoded-word syntax
 */
function encodeHeaderValue(value: string): string {
  if (!/[^\x00-\x7F]/.test(value)) {
    return value;
  }
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

export class DraftsApi {
  private client: GmailClient;

  constructor(client: GmailClient) {
    this.client = client;
  }

  /**
   * List drafts in the user's mailbox
   */
  async list(maxResults: number = 10): Promise<{ drafts: GmailDraft[] }> {
    return this.client.get<{ drafts: GmailDraft[] }>(
      `/users/${this.client.getUserId()}/drafts`,
      { maxResults }
    );
  }

  /**
   * Get a specific draft by ID
   */
  async get(draftId: string): Promise<GmailDraft> {
    return this.client.get<GmailDraft>(
      `/users/${this.client.getUserId()}/drafts/${draftId}`
    );
  }

  /**
   * Create a new draft
   */
  async create(options: SendMessageOptions): Promise<GmailDraft> {
    const message = this.buildRawMessage(options);
    const encodedMessage = Buffer.from(message).toString('base64url');

    return this.client.post<GmailDraft>(
      `/users/${this.client.getUserId()}/drafts`,
      {
        message: {
          raw: encodedMessage,
        },
      }
    );
  }

  /**
   * Update an existing draft
   */
  async update(draftId: string, options: SendMessageOptions): Promise<GmailDraft> {
    const message = this.buildRawMessage(options);
    const encodedMessage = Buffer.from(message).toString('base64url');

    return this.client.put<GmailDraft>(
      `/users/${this.client.getUserId()}/drafts/${draftId}`,
      {
        message: {
          raw: encodedMessage,
        },
      }
    );
  }

  /**
   * Delete a draft
   */
  async delete(draftId: string): Promise<void> {
    await this.client.delete(
      `/users/${this.client.getUserId()}/drafts/${draftId}`
    );
  }

  /**
   * Send a draft
   */
  async send(draftId: string): Promise<GmailMessage> {
    return this.client.post<GmailMessage>(
      `/users/${this.client.getUserId()}/drafts/send`,
      { id: draftId }
    );
  }

  /**
   * Build RFC 2822 formatted message with signature, markdown support
   */
  private buildRawMessage(options: SendMessageOptions): string {
    const settings = loadSettings();

    // Format addresses with contact names
    const formatAddresses = (addresses: string | string[]): string => {
      const addrs = Array.isArray(addresses) ? addresses : [addresses];
      return addrs.map(addr => {
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

    // Append signature (drafts are new emails, not replies)
    if (shouldAppendSignature(false)) {
      const signature = getSignature();
      if (signature) {
        // Gmail signatures are HTML, so convert body to HTML if needed
        if (!isHtml) {
          // Convert plain text to simple HTML
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
    message += `MIME-Version: 1.0\r\n`;

    if (isHtml) {
      // Send multipart/alternative with both plain text and HTML
      const boundary = `boundary_${Date.now()}`;
      const htmlBody = wrapInEmailTemplate(body);
      const plainBody = htmlToPlainText(body);

      message += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
      message += `--${boundary}\r\n`;
      message += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`;
      message += `${plainBody}\r\n`;
      message += `--${boundary}\r\n`;
      message += `Content-Type: text/html; charset="UTF-8"\r\n\r\n`;
      message += `${htmlBody}\r\n`;
      message += `--${boundary}--`;
    } else {
      message += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n`;
      message += body;
    }

    return message;
  }
}
