import type { GmailClient } from './client';

// ============================================
// Watch API Types
// ============================================

export interface WatchRequest {
  labelIds?: string[];
  labelFilterAction?: 'include' | 'exclude';
  topicName: string;
}

export interface WatchResponse {
  historyId: string;
  expiration: string;
}

/**
 * Watch API module - Set up push notifications for mailbox changes
 */
export class WatchApi {
  constructor(private readonly client: GmailClient) {}

  /**
   * Set up or update a push notifications watch
   *
   * @param request - Watch configuration including Pub/Sub topic and optional label filters
   * @returns Watch response with historyId and expiration timestamp
   */
  async start(request: WatchRequest): Promise<WatchResponse> {
    return this.client.post<WatchResponse>('/v1/users/me/watch', request as unknown as Record<string, unknown>);
  }

  /**
   * Stop receiving push notifications on the current watch
   */
  async stop(): Promise<void> {
    await this.client.post('/v1/users/me/stop');
  }
}
