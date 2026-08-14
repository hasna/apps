import type { FigmaClient } from './client';
import type {
  Comment,
  CommentsResponse,
  CommentRequest,
  ClientMeta,
} from '../types';

/**
 * Figma Comments API
 */
export class CommentsApi {
  constructor(private readonly client: FigmaClient) {}

  /**
   * List comments on a file
   * @param fileKey - The file key
   * @param options - Optional parameters
   */
  async listComments(
    fileKey: string,
    options: {
      as_md?: boolean;
    } = {}
  ): Promise<CommentsResponse> {
    return this.client.request<CommentsResponse>(`/files/${fileKey}/comments`, {
      params: options as Record<string, string | number | boolean | undefined>,
    });
  }

  /**
   * Post a comment on a file
   * @param fileKey - The file key
   * @param message - The comment message
   * @param options - Optional parameters
   */
  async postComment(
    fileKey: string,
    message: string,
    options: {
      client_meta?: ClientMeta;
      comment_id?: string;
    } = {}
  ): Promise<Comment> {
    const body: CommentRequest = {
      message,
      ...options,
    };

    return this.client.request<Comment>(`/files/${fileKey}/comments`, {
      method: 'POST',
      body,
    });
  }

  /**
   * Reply to a comment
   * @param fileKey - The file key
   * @param commentId - The parent comment ID
   * @param message - The reply message
   */
  async replyToComment(
    fileKey: string,
    commentId: string,
    message: string
  ): Promise<Comment> {
    return this.postComment(fileKey, message, { comment_id: commentId });
  }

  /**
   * Delete a comment
   * @param fileKey - The file key
   * @param commentId - The comment ID
   */
  async deleteComment(fileKey: string, commentId: string): Promise<void> {
    await this.client.request<void>(`/files/${fileKey}/comments/${commentId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Add a reaction to a comment
   * @param fileKey - The file key
   * @param commentId - The comment ID
   * @param emoji - The emoji to react with
   */
  async addReaction(
    fileKey: string,
    commentId: string,
    emoji: string
  ): Promise<void> {
    await this.client.request<void>(`/files/${fileKey}/comments/${commentId}/reactions`, {
      method: 'POST',
      body: { emoji },
    });
  }

  /**
   * Delete a reaction from a comment
   * @param fileKey - The file key
   * @param commentId - The comment ID
   * @param emoji - The emoji to remove
   */
  async deleteReaction(
    fileKey: string,
    commentId: string,
    emoji: string
  ): Promise<void> {
    await this.client.request<void>(`/files/${fileKey}/comments/${commentId}/reactions`, {
      method: 'DELETE',
      params: { emoji },
    });
  }
}
