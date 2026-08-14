import type { SubstackClient } from './client';
import type { Comment, CommentListResponse } from '../types';

/**
 * Comments API
 * Manage Substack comments on posts
 */
export class CommentsApi {
  constructor(private readonly client: SubstackClient) {}

  /**
   * List comments on a post
   * @param postId - The post ID to get comments for
   * @param options - Pagination options
   */
  async list(postId: number, options: {
    offset?: number;
    limit?: number;
    sort?: 'best' | 'newest' | 'oldest';
  } = {}): Promise<CommentListResponse> {
    const { offset = 0, limit = 50, sort = 'best' } = options;

    const params: Record<string, string | number | boolean | undefined> = {
      offset,
      limit,
      sort,
    };

    const response = await this.client.request<Comment[] | CommentListResponse>(
      `/posts/${postId}/comments`,
      { params }
    );

    // Handle both array and object responses
    if (Array.isArray(response)) {
      return {
        comments: response,
        more: response.length === limit,
      };
    }

    return response;
  }

  /**
   * Get a single comment by ID
   */
  async get(postId: number, commentId: number): Promise<Comment> {
    return this.client.request<Comment>(`/posts/${postId}/comments/${commentId}`);
  }

  /**
   * Get comment count for a post
   */
  async count(postId: number): Promise<number> {
    const response = await this.client.request<{ count: number } | Comment[]>(
      `/posts/${postId}/comments`,
      { params: { limit: 0 } }
    );

    if (typeof response === 'object' && 'count' in response) {
      return response.count;
    }

    // If we get an array, just return its length
    return Array.isArray(response) ? response.length : 0;
  }
}
