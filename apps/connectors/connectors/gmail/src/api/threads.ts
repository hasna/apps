import type { GmailClient } from './client';
import type { GmailThread, ThreadListResponse, ListThreadsOptions } from '../types';

export class ThreadsApi {
  private client: GmailClient;

  constructor(client: GmailClient) {
    this.client = client;
  }

  /**
   * List threads in the user's mailbox
   */
  async list(options: ListThreadsOptions = {}): Promise<ThreadListResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      maxResults: options.maxResults || 10,
      pageToken: options.pageToken,
      q: options.q,
      includeSpamTrash: options.includeSpamTrash,
    };

    if (options.labelIds && options.labelIds.length > 0) {
      params.labelIds = options.labelIds.join(',');
    }

    return this.client.get<ThreadListResponse>(
      `/users/${this.client.getUserId()}/threads`,
      params
    );
  }

  /**
   * Get a specific thread by ID
   */
  async get(threadId: string, format: 'full' | 'metadata' | 'minimal' = 'full'): Promise<GmailThread> {
    return this.client.get<GmailThread>(
      `/users/${this.client.getUserId()}/threads/${threadId}`,
      { format }
    );
  }

  /**
   * Move a thread to trash
   */
  async trash(threadId: string): Promise<GmailThread> {
    return this.client.post<GmailThread>(
      `/users/${this.client.getUserId()}/threads/${threadId}/trash`
    );
  }

  /**
   * Remove a thread from trash
   */
  async untrash(threadId: string): Promise<GmailThread> {
    return this.client.post<GmailThread>(
      `/users/${this.client.getUserId()}/threads/${threadId}/untrash`
    );
  }

  /**
   * Permanently delete a thread
   */
  async delete(threadId: string): Promise<void> {
    await this.client.delete(
      `/users/${this.client.getUserId()}/threads/${threadId}`
    );
  }

  /**
   * Modify thread labels
   */
  async modify(
    threadId: string,
    addLabelIds?: string[],
    removeLabelIds?: string[]
  ): Promise<GmailThread> {
    return this.client.post<GmailThread>(
      `/users/${this.client.getUserId()}/threads/${threadId}/modify`,
      {
        addLabelIds: addLabelIds || [],
        removeLabelIds: removeLabelIds || [],
      }
    );
  }
}
