import type { GmailClient } from './client';
import type { GmailMessage, GmailLabel } from '../types';
import { MessagesApi } from './messages';
import { LabelsApi } from './labels';

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
  /** Gmail search query (e.g., "from:user@example.com", "subject:invoice", "after:2024/01/01") */
  query: string;
  /** Maximum messages to process (default: 100) */
  maxResults?: number;
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually modify, just preview */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, message: MessageSummary) => void;
  /** Error callback */
  onError?: (error: Error, message: MessageSummary) => void;
}

export interface BulkLabelOptions extends BulkOperationOptions {
  /** Label IDs to add */
  addLabelIds?: string[];
  /** Label IDs to remove */
  removeLabelIds?: string[];
  /** Label names to add (will be resolved to IDs) */
  addLabels?: string[];
  /** Label names to remove (will be resolved to IDs) */
  removeLabels?: string[];
}

export interface BulkMarkOptions extends BulkOperationOptions {
  /** Mark as read or unread */
  asRead: boolean;
}

export interface MessageSummary {
  id: string;
  threadId: string;
  from?: string;
  subject?: string;
  date?: string;
  snippet?: string;
  labelIds?: string[];
}

export interface BulkOperationResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ messageId: string; error: string }>;
  processedMessages: MessageSummary[];
}

export interface PreviewResult {
  messages: MessageSummary[];
  total: number;
  query: string;
}

// ============================================
// Batch Request Types (Gmail Batch API)
// ============================================

interface BatchRequest {
  messageId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: GmailClient;
  private readonly messages: MessagesApi;
  private readonly labels: LabelsApi;

  constructor(client: GmailClient) {
    this.client = client;
    this.messages = new MessagesApi(client);
    this.labels = new LabelsApi(client);
  }

  // ============================================
  // Preview Operations
  // ============================================

  /**
   * Preview messages that match a query without making changes
   */
  async preview(query: string, maxResults: number = 50): Promise<PreviewResult> {
    const messages = await this.fetchMessages(query, maxResults);
    return {
      messages,
      total: messages.length,
      query,
    };
  }

  // ============================================
  // Label Operations
  // ============================================

  /**
   * Bulk modify labels on messages matching a query
   */
  async modifyLabels(options: BulkLabelOptions): Promise<BulkOperationResult> {
    const {
      query,
      maxResults = 100,
      concurrency = 10,
      dryRun = false,
      addLabelIds = [],
      removeLabelIds = [],
      addLabels = [],
      removeLabels = [],
      onProgress,
      onError,
    } = options;

    // Resolve label names to IDs
    const resolvedAddIds = [...addLabelIds];
    const resolvedRemoveIds = [...removeLabelIds];

    if (addLabels.length > 0 || removeLabels.length > 0) {
      const allLabels = await this.labels.list();
      const labelMap = new Map(allLabels.labels.map(l => [l.name.toLowerCase(), l.id]));

      for (const name of addLabels) {
        const id = labelMap.get(name.toLowerCase());
        if (id) resolvedAddIds.push(id);
        else throw new Error(`Label not found: ${name}`);
      }

      for (const name of removeLabels) {
        const id = labelMap.get(name.toLowerCase());
        if (id) resolvedRemoveIds.push(id);
        else throw new Error(`Label not found: ${name}`);
      }
    }

    if (resolvedAddIds.length === 0 && resolvedRemoveIds.length === 0) {
      throw new Error('At least one label to add or remove is required');
    }

    const messages = await this.fetchMessages(query, maxResults);

    return this.executeBatch(messages, {
      dryRun,
      concurrency,
      onProgress,
      onError,
      operation: async (msg) => {
        await this.messages.modify(msg.id, resolvedAddIds, resolvedRemoveIds);
      },
    });
  }

  /**
   * Bulk add labels to messages
   */
  async addLabels(options: Omit<BulkLabelOptions, 'removeLabelIds' | 'removeLabels'>): Promise<BulkOperationResult> {
    return this.modifyLabels({
      ...options,
      removeLabelIds: [],
      removeLabels: [],
    });
  }

  /**
   * Bulk remove labels from messages
   */
  async removeLabels(options: Omit<BulkLabelOptions, 'addLabelIds' | 'addLabels'>): Promise<BulkOperationResult> {
    return this.modifyLabels({
      ...options,
      addLabelIds: [],
      addLabels: [],
    });
  }

  // ============================================
  // Archive Operations
  // ============================================

  /**
   * Bulk archive messages (remove INBOX label)
   */
  async archive(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const messages = await this.fetchMessages(options.query, options.maxResults || 100);

    return this.executeBatch(messages, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (msg) => {
        await this.messages.archive(msg.id);
      },
    });
  }

  /**
   * Bulk unarchive messages (add INBOX label)
   */
  async unarchive(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const messages = await this.fetchMessages(options.query, options.maxResults || 100);

    return this.executeBatch(messages, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (msg) => {
        await this.messages.modify(msg.id, ['INBOX'], undefined);
      },
    });
  }

  // ============================================
  // Trash/Delete Operations
  // ============================================

  /**
   * Bulk move messages to trash
   */
  async trash(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const messages = await this.fetchMessages(options.query, options.maxResults || 100);

    return this.executeBatch(messages, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (msg) => {
        await this.messages.trash(msg.id);
      },
    });
  }

  /**
   * Bulk permanently delete messages (DANGER!)
   */
  async delete(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const messages = await this.fetchMessages(options.query, options.maxResults || 100);

    return this.executeBatch(messages, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (msg) => {
        await this.messages.delete(msg.id);
      },
    });
  }

  /**
   * Bulk restore messages from trash
   */
  async untrash(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const messages = await this.fetchMessages(options.query, options.maxResults || 100);

    return this.executeBatch(messages, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (msg) => {
        await this.messages.untrash(msg.id);
      },
    });
  }

  // ============================================
  // Read/Unread Operations
  // ============================================

  /**
   * Bulk mark messages as read
   */
  async markAsRead(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const messages = await this.fetchMessages(options.query, options.maxResults || 100);

    return this.executeBatch(messages, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (msg) => {
        await this.messages.markAsRead(msg.id);
      },
    });
  }

  /**
   * Bulk mark messages as unread
   */
  async markAsUnread(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const messages = await this.fetchMessages(options.query, options.maxResults || 100);

    return this.executeBatch(messages, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (msg) => {
        await this.messages.markAsUnread(msg.id);
      },
    });
  }

  // ============================================
  // Star Operations
  // ============================================

  /**
   * Bulk star messages
   */
  async star(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const messages = await this.fetchMessages(options.query, options.maxResults || 100);

    return this.executeBatch(messages, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (msg) => {
        await this.messages.star(msg.id);
      },
    });
  }

  /**
   * Bulk unstar messages
   */
  async unstar(options: BulkOperationOptions): Promise<BulkOperationResult> {
    const messages = await this.fetchMessages(options.query, options.maxResults || 100);

    return this.executeBatch(messages, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (msg) => {
        await this.messages.unstar(msg.id);
      },
    });
  }

  // ============================================
  // Gmail Batch Modify API (more efficient)
  // ============================================

  /**
   * Use Gmail's native batchModify endpoint for efficient bulk label operations
   * This is much faster than individual requests for large batches
   */
  async batchModifyLabels(options: {
    query: string;
    maxResults?: number;
    addLabelIds?: string[];
    removeLabelIds?: string[];
    addLabels?: string[];
    removeLabels?: string[];
    dryRun?: boolean;
  }): Promise<BulkOperationResult> {
    const {
      query,
      maxResults = 1000,
      addLabelIds = [],
      removeLabelIds = [],
      addLabels = [],
      removeLabels = [],
      dryRun = false,
    } = options;

    // Resolve label names to IDs
    const resolvedAddIds = [...addLabelIds];
    const resolvedRemoveIds = [...removeLabelIds];

    if (addLabels.length > 0 || removeLabels.length > 0) {
      const allLabels = await this.labels.list();
      const labelMap = new Map(allLabels.labels.map(l => [l.name.toLowerCase(), l.id]));

      for (const name of addLabels) {
        const id = labelMap.get(name.toLowerCase());
        if (id) resolvedAddIds.push(id);
        else throw new Error(`Label not found: ${name}`);
      }

      for (const name of removeLabels) {
        const id = labelMap.get(name.toLowerCase());
        if (id) resolvedRemoveIds.push(id);
        else throw new Error(`Label not found: ${name}`);
      }
    }

    // Fetch message IDs
    const messages = await this.fetchMessageIds(query, maxResults);

    const result: BulkOperationResult = {
      total: messages.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      processedMessages: [],
    };

    if (messages.length === 0) {
      return result;
    }

    if (dryRun) {
      result.success = messages.length;
      result.processedMessages = messages.map(id => ({ id, threadId: '' }));
      return result;
    }

    // Gmail's batchModify can handle up to 1000 messages at once
    const batchSize = 1000;
    const batches = this.chunkArray(messages, batchSize);

    for (const batch of batches) {
      try {
        await this.client.post(
          `/users/${this.client.getUserId()}/messages/batchModify`,
          {
            ids: batch,
            addLabelIds: resolvedAddIds.length > 0 ? resolvedAddIds : undefined,
            removeLabelIds: resolvedRemoveIds.length > 0 ? resolvedRemoveIds : undefined,
          }
        );
        result.success += batch.length;
        result.processedMessages.push(...batch.map(id => ({ id, threadId: '' })));
      } catch (err) {
        result.failed += batch.length;
        const errorMessage = err instanceof Error ? err.message : String(err);
        for (const id of batch) {
          result.errors.push({ messageId: id, error: errorMessage });
        }
      }
    }

    return result;
  }

  /**
   * Use Gmail's native batchDelete endpoint for efficient bulk deletion
   * WARNING: This permanently deletes messages!
   */
  async batchDelete(options: {
    query: string;
    maxResults?: number;
    dryRun?: boolean;
  }): Promise<BulkOperationResult> {
    const { query, maxResults = 1000, dryRun = false } = options;

    const messages = await this.fetchMessageIds(query, maxResults);

    const result: BulkOperationResult = {
      total: messages.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      processedMessages: [],
    };

    if (messages.length === 0) {
      return result;
    }

    if (dryRun) {
      result.success = messages.length;
      result.processedMessages = messages.map(id => ({ id, threadId: '' }));
      return result;
    }

    // Gmail's batchDelete can handle up to 1000 messages at once
    const batchSize = 1000;
    const batches = this.chunkArray(messages, batchSize);

    for (const batch of batches) {
      try {
        await this.client.post(
          `/users/${this.client.getUserId()}/messages/batchDelete`,
          { ids: batch }
        );
        result.success += batch.length;
        result.processedMessages.push(...batch.map(id => ({ id, threadId: '' })));
      } catch (err) {
        result.failed += batch.length;
        const errorMessage = err instanceof Error ? err.message : String(err);
        for (const id of batch) {
          result.errors.push({ messageId: id, error: errorMessage });
        }
      }
    }

    return result;
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Fetch messages matching a query with full metadata
   */
  private async fetchMessages(query: string, maxResults: number): Promise<MessageSummary[]> {
    const messages: MessageSummary[] = [];
    let pageToken: string | undefined;

    while (messages.length < maxResults) {
      const response = await this.messages.list({
        q: query,
        maxResults: Math.min(100, maxResults - messages.length),
        pageToken,
      });

      if (!response.messages || response.messages.length === 0) {
        break;
      }

      // Fetch metadata for each message
      const metadataPromises = response.messages.map(async (m) => {
        const msg = await this.messages.get(m.id, 'metadata');
        const headers = msg.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value;

        return {
          id: m.id,
          threadId: m.threadId,
          from: getHeader('from'),
          subject: getHeader('subject'),
          date: getHeader('date'),
          snippet: msg.snippet,
          labelIds: msg.labelIds,
        };
      });

      const fetchedMessages = await Promise.all(metadataPromises);
      messages.push(...fetchedMessages);

      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }

    return messages;
  }

  /**
   * Fetch only message IDs (faster for batch operations)
   */
  private async fetchMessageIds(query: string, maxResults: number): Promise<string[]> {
    const messageIds: string[] = [];
    let pageToken: string | undefined;

    while (messageIds.length < maxResults) {
      const response = await this.messages.list({
        q: query,
        maxResults: Math.min(500, maxResults - messageIds.length),
        pageToken,
      });

      if (!response.messages || response.messages.length === 0) {
        break;
      }

      messageIds.push(...response.messages.map(m => m.id));

      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }

    return messageIds;
  }

  /**
   * Execute operations in batches with concurrency control
   */
  private async executeBatch(
    messages: MessageSummary[],
    options: {
      dryRun: boolean;
      concurrency: number;
      onProgress?: (current: number, total: number, message: MessageSummary) => void;
      onError?: (error: Error, message: MessageSummary) => void;
      operation: (message: MessageSummary) => Promise<void>;
    }
  ): Promise<BulkOperationResult> {
    const { dryRun, concurrency, onProgress, onError, operation } = options;

    const result: BulkOperationResult = {
      total: messages.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      processedMessages: [],
    };

    if (messages.length === 0) {
      return result;
    }

    // Process in batches with concurrency control
    const chunks = this.chunkArray(messages, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (msg) => {
          try {
            if (dryRun) {
              result.success++;
              result.processedMessages.push(msg);
            } else {
              await operation(msg);
              result.success++;
              result.processedMessages.push(msg);
            }

            if (onProgress) {
              onProgress(result.success + result.failed, result.total, msg);
            }
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ messageId: msg.id, error: errorMessage });

            if (onError) {
              onError(err instanceof Error ? err : new Error(errorMessage), msg);
            }
          }
        })
      );
    }

    return result;
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
