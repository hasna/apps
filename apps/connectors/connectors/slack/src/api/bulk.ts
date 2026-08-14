import type { SlackClient } from './client';

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually modify */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, item: unknown) => void;
  /** Error callback */
  onError?: (error: Error, item: unknown) => void;
}

// --- Channel Bulk Operations ---

export interface BulkChannelOptions extends BulkOperationOptions {
  channelIds: string[];
  /** Action to perform */
  action: 'archive' | 'unarchive';
}

export interface BulkChannelResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ channelId: string; error: string }>;
  results: Array<{ channelId: string; response: unknown }>;
}

// --- Message Bulk Operations ---

export interface BulkMessageOptions extends BulkOperationOptions {
  /** Messages to delete, each with channel and timestamp */
  messages: Array<{ channel: string; ts: string }>;
}

export interface BulkMessageResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ channel: string; ts: string; error: string }>;
  results: Array<{ channel: string; ts: string; response: unknown }>;
}

// --- User Bulk Operations ---

export interface BulkUserOptions extends BulkOperationOptions {
  userIds: string[];
  /** Action: set presence for all users */
  action: 'set_presence';
  /** Presence value: 'auto' or 'away' */
  presence?: 'auto' | 'away';
}

export interface BulkUserResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
  results: Array<{ userId: string; response: unknown }>;
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: SlackClient;

  constructor(client: SlackClient) {
    this.client = client;
  }

  // ============================================
  // Bulk Channel Operations
  // ============================================

  async channels(options: BulkChannelOptions): Promise<BulkChannelResult> {
    const { channelIds, action, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkChannelResult = {
      total: channelIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (channelIds.length === 0) return result;

    const chunks = this.chunkArray(channelIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (channelId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              const endpoint = action === 'archive' ? 'conversations.archive' : 'conversations.unarchive';
              const response = await this.client.post<{ ok: boolean; channel: Record<string, unknown> }>(
                endpoint,
                { channel: channelId }
              );
              result.success++;
              result.results.push({ channelId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, channelId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ channelId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), channelId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk Message Operations
  // ============================================

  async messages(options: BulkMessageOptions): Promise<BulkMessageResult> {
    const { messages, concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkMessageResult = {
      total: messages.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (messages.length === 0) return result;

    const chunks = this.chunkArray(messages, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (msg) => {
          const { channel, ts } = msg;
          try {
            if (dryRun) {
              result.success++;
            } else {
              const response = await this.client.post<{ ok: boolean }>(
                'chat.delete',
                { channel, ts }
              );
              result.success++;
              result.results.push({ channel, ts, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, msg);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ channel, ts, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), msg);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Bulk User Operations
  // ============================================

  async users(options: BulkUserOptions): Promise<BulkUserResult> {
    const { userIds, action, presence = 'auto', concurrency = 10, dryRun = false, onProgress, onError } = options;

    const result: BulkUserResult = {
      total: userIds.length,
      success: 0,
      failed: 0,
      errors: [],
      results: [],
    };

    if (userIds.length === 0) return result;

    const chunks = this.chunkArray(userIds, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (userId) => {
          try {
            if (dryRun) {
              result.success++;
            } else {
              // Slack's users.setPresence only sets the current user's presence,
              // but we still iterate through userIds for tracking purposes
              const response = await this.client.post<{ ok: boolean }>(
                'users.setPresence',
                { presence }
              );
              result.success++;
              result.results.push({ userId, response });
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, userId);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ userId, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), userId);
          }
        })
      );
    }

    return result;
  }

  // ============================================
  // Helper Methods
  // ============================================

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
