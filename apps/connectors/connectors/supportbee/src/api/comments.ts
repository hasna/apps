import type { ConnectorClient } from './client';
import type { Comment, CommentCreateParams } from '../types';

export interface CommentListResponse {
  comments: Comment[];
}

export interface CommentResponse {
  comment: Comment;
}

export class CommentsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(ticketId: number | string): Promise<CommentListResponse> {
    return this.client.get<CommentListResponse>(`/tickets/${ticketId}/comments`);
  }

  async create(ticketId: number | string, params: CommentCreateParams): Promise<CommentResponse> {
    return this.client.post<CommentResponse>(`/tickets/${ticketId}/comments`, { comment: params });
  }
}
