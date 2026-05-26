import type { GmailClient } from './client';
import type { GmailMessage, GmailLabel } from '../types';
import { MessagesApi } from './messages';
import { LabelsApi } from './labels';

/**
 * Returns true if the value looks like a Gmail label ID rather than a label name.
 * User-created label IDs start with "Label_". System label IDs are all-uppercase
 * ASCII (e.g. INBOX, SENT, UNREAD, STARRED, IMPORTANT, TRASH, SPAM, CATEGORY_*).
 */
function isLabelId(value: string): boolean {
  return value.startsWith('Label_') || /^[A-Z0-9_]+$/.test(value);
}

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
  /** Skip messages that already have all the labels being added */
  skipIfLabeled?: boolean;
  /** Skip first N results (pagination offset) */
  offset?: number;
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
      skipIfLabeled = false,
      offset = 0,
      onProgress,
      onError,
    } = options;

    // Resolve label names to IDs
    const resolvedAddIds = [...addLabelIds];
    const resolvedRemoveIds = [...removeLabelIds];

    if (addLabels.length > 0 || removeLabels.length > 0) {
      // Lazily fetch the label list only if we have names that need resolving
      const needsLookup = [...addLabels, ...removeLabels].some(v => !isLabelId(v));
      let labelMap: Map<string, string> = new Map();
      if (needsLookup) {
        const allLabels = await this.labels.list();
        labelMap = new Map(allLabels.labels.map(l => [l.name.toLowerCase(), l.id]));
      }

      for (const value of addLabels) {
        if (isLabelId(value)) {
          resolvedAddIds.push(value);
        } else {
          const id = labelMap.get(value.toLowerCase());
          if (id) resolvedAddIds.push(id);
          else throw new Error(`Label not found: ${value}`);
        }
      }

      for (const value of removeLabels) {
        if (isLabelId(value)) {
          resolvedRemoveIds.push(value);
        } else {
          const id = labelMap.get(value.toLowerCase());
          if (id) resolvedRemoveIds.push(id);
          else throw new Error(`Label not found: ${value}`);
        }
      }
    }

    if (resolvedAddIds.length === 0 && resolvedRemoveIds.length === 0) {
      throw new Error('At least one label to add or remove is required');
    }

    // Fetch enough messages to account for the offset
    const fetchLimit = maxResults === Infinity ? Number.MAX_SAFE_INTEGER : maxResults + offset;
    let messages = await this.fetchMessages(query, fetchLimit);

    // Apply offset: skip first N results
    if (offset > 0) {
      messages = messages.slice(offset);
    }

    // Trim to requested maxResults after offset
    if (maxResults !== Infinity && messages.length > maxResults) {
      messages = messages.slice(0, maxResults);
    }

    // Skip messages that already have all the labels being added
    if (skipIfLabeled && resolvedAddIds.length > 0) {
      messages = messages.filter((msg) => {
        const existing = msg.labelIds || [];
        return !resolvedAddIds.every(id => existing.includes(id));
      });
    }

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
    skipIfLabeled?: boolean;
    offset?: number;
  }): Promise<BulkOperationResult> {
    const {
      query,
      maxResults = 1000,
      addLabelIds = [],
      removeLabelIds = [],
      addLabels = [],
      removeLabels = [],
      dryRun = false,
      skipIfLabeled = false,
      offset = 0,
    } = options;

    // Resolve label names to IDs
    const resolvedAddIds = [...addLabelIds];
    const resolvedRemoveIds = [...removeLabelIds];

    if (addLabels.length > 0 || removeLabels.length > 0) {
      // Lazily fetch the label list only if we have names that need resolving
      const needsLookup = [...addLabels, ...removeLabels].some(v => !isLabelId(v));
      let labelMap: Map<string, string> = new Map();
      if (needsLookup) {
        const allLabels = await this.labels.list();
        labelMap = new Map(allLabels.labels.map(l => [l.name.toLowerCase(), l.id]));
      }

      for (const value of addLabels) {
        if (isLabelId(value)) {
          resolvedAddIds.push(value);
        } else {
          const id = labelMap.get(value.toLowerCase());
          if (id) resolvedAddIds.push(id);
          else throw new Error(`Label not found: ${value}`);
        }
      }

      for (const value of removeLabels) {
        if (isLabelId(value)) {
          resolvedRemoveIds.push(value);
        } else {
          const id = labelMap.get(value.toLowerCase());
          if (id) resolvedRemoveIds.push(id);
          else throw new Error(`Label not found: ${value}`);
        }
      }
    }

    // For skipIfLabeled, we need full metadata (label IDs), so use fetchMessages
    // For plain offset/pagination without skip, fetchMessageIds is sufficient
    let messageIds: string[];
    if (skipIfLabeled && resolvedAddIds.length > 0) {
      const fetchLimit = maxResults === Infinity ? Number.MAX_SAFE_INTEGER : maxResults + offset;
      let msgs = await this.fetchMessages(query, fetchLimit);
      if (offset > 0) msgs = msgs.slice(offset);
      if (maxResults !== Infinity && msgs.length > maxResults) msgs = msgs.slice(0, maxResults);
      msgs = msgs.filter((msg) => {
        const existing = msg.labelIds || [];
        return !resolvedAddIds.every(id => existing.includes(id));
      });
      messageIds = msgs.map(m => m.id);
    } else {
      // Fetch message IDs, accounting for offset
      const fetchLimit = maxResults === Infinity ? Number.MAX_SAFE_INTEGER : maxResults + offset;
      let ids = await this.fetchMessageIds(query, fetchLimit);
      if (offset > 0) ids = ids.slice(offset);
      if (maxResults !== Infinity && ids.length > maxResults) ids = ids.slice(0, maxResults);
      messageIds = ids;
    }

    // Use local variable name to avoid conflict with outer scope
    const messages = messageIds;

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
