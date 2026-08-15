import type { ElevenLabsClient } from './client';
import type { HistoryItem, HistoryResponse } from '../types';

/**
 * History API module
 * Access generation history
 */
export class HistoryApi {
  constructor(private readonly client: ElevenLabsClient) {}

  /**
   * Get generation history
   */
  async list(options?: {
    pageSize?: number;
    startAfterHistoryItemId?: string;
    voiceId?: string;
  }): Promise<HistoryResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      page_size: options?.pageSize || 100,
      start_after_history_item_id: options?.startAfterHistoryItemId,
      voice_id: options?.voiceId,
    };

    return this.client.get<HistoryResponse>('/v1/history', params);
  }

  /**
   * Get all history items (paginated)
   */
  async listAll(options?: {
    voiceId?: string;
    maxItems?: number;
  }): Promise<HistoryItem[]> {
    const allItems: HistoryItem[] = [];
    let cursor: string | undefined;
    const maxItems = options?.maxItems || 1000;

    while (allItems.length < maxItems) {
      const response = await this.list({
        pageSize: 100,
        startAfterHistoryItemId: cursor,
        voiceId: options?.voiceId,
      });

      allItems.push(...response.history);

      if (!response.has_more || !response.last_history_item_id) {
        break;
      }

      cursor = response.last_history_item_id;
    }

    return allItems.slice(0, maxItems);
  }

  /**
   * Get a specific history item
   */
  async get(historyItemId: string): Promise<HistoryItem> {
    return this.client.get<HistoryItem>(`/v1/history/${historyItemId}`);
  }

  /**
   * Get audio for a history item
   */
  async getAudio(historyItemId: string): Promise<ArrayBuffer> {
    return this.client.get<ArrayBuffer>(
      `/v1/history/${historyItemId}/audio`,
      undefined,
      { responseType: 'arraybuffer' }
    );
  }

  /**
   * Delete a history item
   */
  async delete(historyItemId: string): Promise<{ status: string }> {
    return this.client.delete<{ status: string }>(`/v1/history/${historyItemId}`);
  }

  /**
   * Delete multiple history items
   */
  async deleteMany(historyItemIds: string[]): Promise<{ status: string }> {
    return this.client.post<{ status: string }>('/v1/history/delete', {
      history_item_ids: historyItemIds,
    });
  }

  /**
   * Download history items as zip
   */
  async downloadZip(historyItemIds: string[]): Promise<ArrayBuffer> {
    return this.client.post<ArrayBuffer>(
      '/v1/history/download',
      { history_item_ids: historyItemIds },
      undefined,
      { responseType: 'arraybuffer' }
    );
  }
}
