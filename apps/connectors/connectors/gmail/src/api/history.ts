import type { GmailClient } from './client';

// ============================================
// History API Types
// ============================================

export interface ListHistoryOptions {
  startHistoryId: string;
  historyTypes?: ('messageAdded' | 'messageChanged' | 'messageDeleted' | 'labelAdded' | 'labelRemoved')[];
  labelId?: string;
  maxResults?: number;
  pageToken?: string;
}

export interface HistoryRecord {
  id: string;
  messages?: Array<{
    id: string;
    threadId: string;
  }>;
  messagesAdded?: Array<{
    message: { id: string; threadId: string };
  }>;
  messagesDeleted?: Array<{
    message: { id: string; threadId: string };
  }>;
  labelsAdded?: Array<{
    message: { id: string; threadId: string };
    labelIds: string[];
  }>;
  labelsRemoved?: Array<{
    message: { id: string; threadId: string };
    labelIds: string[];
  }>;
  messageChanged?: Array<{
    message: { id: string; threadId: string };
  }>;
}

export interface ListHistoryResponse {
  history?: HistoryRecord[];
  nextPageToken?: string;
  historyId: string;
}

/**
 * History API module - retrieve mailbox change history
 */
export class HistoryApi {
  constructor(private readonly client: GmailClient) {}

  /**
   * List the history of all changes to the user's mailbox
   */
  async list(options: ListHistoryOptions): Promise<ListHistoryResponse> {
    const params: Record<string, string | number> = {
      startHistoryId: options.startHistoryId,
    };
    if (options.historyTypes && options.historyTypes.length > 0) {
      params.historyTypes = options.historyTypes.join(',');
    }
    if (options.labelId) params.labelId = options.labelId;
    if (options.maxResults) params.maxResults = options.maxResults;
    if (options.pageToken) params.pageToken = options.pageToken;

    return this.client.get<ListHistoryResponse>('/v1/users/me/history', params);
  }

  /**
   * Iterate over all history records (handles pagination)
   */
  async *listAll(options: Omit<ListHistoryOptions, 'pageToken'>): AsyncGenerator<HistoryRecord> {
    let pageToken: string | undefined;
    do {
      const response = await this.list({ ...options, pageToken });
      for (const record of response.history || []) {
        yield record;
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
  }
}
