import type { ResendClient } from './client';
import type {
  Broadcast,
  CreateBroadcastParams,
  UpdateBroadcastParams,
  SendBroadcastParams,
  SendBroadcastResponse,
  ListResponse,
} from '../types';

/**
 * Broadcasts API - Create, list, get, update, send, and delete email broadcasts/campaigns
 * https://resend.com/docs/api-reference/broadcasts
 */
export class BroadcastsApi {
  constructor(private readonly client: ResendClient) {}

  /**
   * Create a new broadcast
   * POST /broadcasts
   */
  async create(params: CreateBroadcastParams): Promise<Broadcast> {
    return this.client.post<Broadcast>('/broadcasts', params);
  }

  /**
   * List all broadcasts
   * GET /broadcasts
   */
  async list(): Promise<ListResponse<Broadcast>> {
    return this.client.get<ListResponse<Broadcast>>('/broadcasts');
  }

  /**
   * Get a single broadcast by ID
   * GET /broadcasts/:id
   */
  async get(broadcastId: string): Promise<Broadcast> {
    return this.client.get<Broadcast>(`/broadcasts/${broadcastId}`);
  }

  /**
   * Update a broadcast (only drafts can be updated)
   * PATCH /broadcasts/:id
   */
  async update(broadcastId: string, params: UpdateBroadcastParams): Promise<Broadcast> {
    return this.client.patch<Broadcast>(`/broadcasts/${broadcastId}`, params);
  }

  /**
   * Delete a broadcast (only drafts can be deleted)
   * DELETE /broadcasts/:id
   */
  async delete(broadcastId: string): Promise<{ deleted: boolean; id: string }> {
    return this.client.delete<{ deleted: boolean; id: string }>(`/broadcasts/${broadcastId}`);
  }

  /**
   * Send a broadcast immediately or schedule it
   * POST /broadcasts/:id/send
   */
  async send(broadcastId: string, params?: SendBroadcastParams): Promise<SendBroadcastResponse> {
    return this.client.post<SendBroadcastResponse>(`/broadcasts/${broadcastId}/send`, params || {});
  }
}
