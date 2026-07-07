import type { ConnectorClient } from './client';
import type { Reply, ReplyCreateParams } from '../types';

export interface ReplyListResponse {
  replies: Reply[];
}

export interface ReplyResponse {
  reply: Reply;
}

export class RepliesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(ticketId: number | string): Promise<ReplyListResponse> {
    return this.client.get<ReplyListResponse>(`/tickets/${ticketId}/replies`);
  }

  async create(ticketId: number | string, params: ReplyCreateParams): Promise<ReplyResponse> {
    return this.client.post<ReplyResponse>(`/tickets/${ticketId}/replies`, { reply: params });
  }
}
