import { writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import type { GmailClient } from './client';
import type { GmailMessage, MessageListResponse } from '../types';
import { ensureExportsDir } from '../utils/config';

export interface ExportOptions {
  query?: string;
  labelIds?: string[];
  maxResults?: number;
  outputDir?: string;
  filename?: string;
  format?: 'eml' | 'mbox';
  includeAttachments?: boolean;
}

export interface ExportResult {
  messageCount: number;
  filePath: string;
  format: string;
}

export class ExportApi {
  constructor(private readonly client: GmailClient) {}

  // ============================================
  // Main Export Methods
  // ============================================

  /**
   * Export messages to EML or MBOX format
   */
  async exportMessages(options: ExportOptions = {}): Promise<ExportResult> {
    const format = options.format || 'eml';
    const messages = await this.getMessages(options);

    if (messages.length === 0) {
      const outputDir = options.outputDir || ensureExportsDir();
      const filename = options.filename || `emails_${new Date().toISOString().split('T')[0]}.${format === 'mbox' ? 'mbox' : 'eml'}`;
      const filePath = join(outputDir, filename);
      writeFileSync(filePath, '', 'utf-8');
      return {
        messageCount: 0,
        filePath,
        format,
      };
    }

    if (format === 'mbox') {
      return this.exportToMbox(messages, options);
    } else {
      return this.exportToEml(messages, options);
    }
  }

  /**
   * Export messages from a specific label
   */
  async exportLabel(labelId: string, options: Omit<ExportOptions, 'labelIds'> = {}): Promise<ExportResult> {
    return this.exportMessages({
      ...options,
      labelIds: [labelId],
    });
  }

  /**
   * Export inbox messages
   */
  async exportInbox(options: Omit<ExportOptions, 'labelIds'> = {}): Promise<ExportResult> {
    return this.exportLabel('INBOX', options);
  }

  /**
   * Export sent messages
   */
  async exportSent(options: Omit<ExportOptions, 'labelIds'> = {}): Promise<ExportResult> {
    return this.exportLabel('SENT', options);
  }

  /**
   * Export starred messages
   */
  async exportStarred(options: Omit<ExportOptions, 'labelIds'> = {}): Promise<ExportResult> {
    return this.exportLabel('STARRED', options);
  }

  /**
   * Export a single message
   */
  async exportMessage(messageId: string, options: { outputDir?: string; filename?: string } = {}): Promise<ExportResult> {
    const message = await this.client.get<GmailMessage>(
      `/users/${this.client.getUserId()}/messages/${messageId}`,
      { format: 'raw' }
    );

    const outputDir = options.outputDir || ensureExportsDir();
    const filename = options.filename || `message_${messageId}.eml`;
    const filePath = join(outputDir, filename);

    if (!existsSync(dirname(filePath))) {
      mkdirSync(dirname(filePath), { recursive: true });
    }

    // Decode the raw message from base64url
    const rawContent = this.decodeBase64Url(message.raw || '');
    writeFileSync(filePath, rawContent, 'utf-8');

    return {
      messageCount: 1,
      filePath,
      format: 'eml',
    };
  }

  /**
   * Export a thread (all messages in a conversation)
   */
  async exportThread(threadId: string, options: Omit<ExportOptions, 'query' | 'labelIds'> = {}): Promise<ExportResult> {
    const thread = await this.client.get<{ messages: Array<{ id: string }> }>(
      `/users/${this.client.getUserId()}/threads/${threadId}`,
      { format: 'minimal' }
    );

    const messageIds = thread.messages.map(m => m.id);
    const messages: GmailMessage[] = [];

    for (const id of messageIds) {
      const message = await this.client.get<GmailMessage>(
        `/users/${this.client.getUserId()}/messages/${id}`,
        { format: 'raw' }
      );
      messages.push(message);
    }

    const format = options.format || 'mbox';
    if (format === 'mbox') {
      return this.exportToMbox(messages, {
        ...options,
        filename: options.filename || `thread_${threadId}.mbox`,
      });
    } else {
      return this.exportToEml(messages, {
        ...options,
        filename: options.filename || `thread_${threadId}`,
      });
    }
  }

  // ============================================
  // Export Formats
  // ============================================

  private async exportToEml(messages: GmailMessage[], options: ExportOptions): Promise<ExportResult> {
    const outputDir = options.outputDir || ensureExportsDir();
    const timestamp = new Date().toISOString().split('T')[0];
    const exportDir = join(outputDir, options.filename || `emails_${timestamp}`);

    if (!existsSync(exportDir)) {
      mkdirSync(exportDir, { recursive: true });
    }

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const rawContent = this.decodeBase64Url(message.raw || '');

      // Get subject for filename
      const subjectMatch = rawContent.match(/^Subject:\s*(.+)$/m);
      let subject = subjectMatch ? subjectMatch[1].trim() : `message_${i + 1}`;
      subject = this.sanitizeFilename(subject).slice(0, 50);

      const filename = `${i + 1}_${message.id}_${subject}.eml`;
      const filePath = join(exportDir, filename);

      writeFileSync(filePath, rawContent, 'utf-8');
    }

    return {
      messageCount: messages.length,
      filePath: exportDir,
      format: 'eml',
    };
  }

  private async exportToMbox(messages: GmailMessage[], options: ExportOptions): Promise<ExportResult> {
    const outputDir = options.outputDir || ensureExportsDir();
    const filename = options.filename || `emails_${new Date().toISOString().split('T')[0]}.mbox`;
    const filePath = join(outputDir, filename);

    if (!existsSync(dirname(filePath))) {
      mkdirSync(dirname(filePath), { recursive: true });
    }

    // Clear or create the file
    writeFileSync(filePath, '', 'utf-8');

    for (const message of messages) {
      const rawContent = this.decodeBase64Url(message.raw || '');

      // Get the From header for the mbox "From " line
      const fromMatch = rawContent.match(/^From:\s*(.+)$/m);
      let fromAddr = 'unknown@unknown.com';
      if (fromMatch) {
        const emailMatch = fromMatch[1].match(/<([^>]+)>/) || fromMatch[1].match(/([^\s<>]+@[^\s<>]+)/);
        if (emailMatch) {
          fromAddr = emailMatch[1];
        }
      }

      // Get date for the mbox "From " line
      const dateMatch = rawContent.match(/^Date:\s*(.+)$/m);
      let mboxDate = new Date().toUTCString();
      if (dateMatch) {
        try {
          const parsed = new Date(dateMatch[1]);
          if (!isNaN(parsed.getTime())) {
            // Convert to mbox format: "Mon Jan 01 12:00:00 2024"
            mboxDate = parsed.toUTCString().replace(/,/g, '').replace(/ GMT$/, '');
          }
        } catch {
          // Keep default date
        }
      }

      // Write mbox format: "From <email> <date>\n<raw message>\n"
      const mboxLine = `From ${fromAddr} ${mboxDate}\n`;
      appendFileSync(filePath, mboxLine, 'utf-8');

      // Escape any "From " lines at the start of message body lines
      const escapedContent = rawContent.replace(/^From /gm, '>From ');
      appendFileSync(filePath, escapedContent, 'utf-8');

      // Ensure message ends with newline
      if (!rawContent.endsWith('\n')) {
        appendFileSync(filePath, '\n', 'utf-8');
      }
      appendFileSync(filePath, '\n', 'utf-8');
    }

    return {
      messageCount: messages.length,
      filePath,
      format: 'mbox',
    };
  }

  // ============================================
  // Helper Methods
  // ============================================

  private async getMessages(options: ExportOptions): Promise<GmailMessage[]> {
    const messages: GmailMessage[] = [];
    let pageToken: string | undefined;
    const maxResults = options.maxResults || 1000;
    let fetched = 0;

    do {
      const params: Record<string, string | number | boolean | undefined> = {
        maxResults: Math.min(100, maxResults - fetched),
        pageToken,
        q: options.query,
        includeSpamTrash: false,
      };

      if (options.labelIds && options.labelIds.length > 0) {
        params.labelIds = options.labelIds.join(',');
      }

      const response = await this.client.get<MessageListResponse>(
        `/users/${this.client.getUserId()}/messages`,
        params
      );

      if (!response.messages || response.messages.length === 0) {
        break;
      }

      // Fetch full raw content for each message
      for (const msg of response.messages) {
        if (fetched >= maxResults) break;

        const fullMessage = await this.client.get<GmailMessage>(
          `/users/${this.client.getUserId()}/messages/${msg.id}`,
          { format: 'raw' }
        );
        messages.push(fullMessage);
        fetched++;
      }

      pageToken = response.nextPageToken;
    } while (pageToken && fetched < maxResults);

    return messages;
  }

  private decodeBase64Url(encoded: string): string {
    // Convert base64url to base64
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    while (base64.length % 4) {
      base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 200);
  }
}
