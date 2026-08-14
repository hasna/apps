import type { YouTubeClient } from './client';
import type {
  Comment,
  CommentListParams,
  ListResponse,
} from '../types';

export interface CommentInsertParams {
  part: string[];
}

export interface CommentUpdateParams {
  part: string[];
}

export type ModerationStatus = 'heldForReview' | 'likelySpam' | 'published' | 'rejected';

export class CommentsApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * List comments
   * Quota cost: 1 unit per request
   */
  async list(params: CommentListParams): Promise<ListResponse<Comment>> {
    return this.client.get<ListResponse<Comment>>('/comments', {
      part: params.part,
      id: params.id,
      parentId: params.parentId,
      maxResults: params.maxResults,
      pageToken: params.pageToken,
      textFormat: params.textFormat,
    });
  }

  /**
   * Get a single comment by ID
   */
  async get(commentId: string, parts: string[] = ['snippet']): Promise<Comment | null> {
    const response = await this.list({ part: parts, id: commentId });
    return response.items[0] || null;
  }

  /**
   * Get multiple comments by IDs
   */
  async getMany(commentIds: string[], parts: string[] = ['snippet']): Promise<Comment[]> {
    const response = await this.list({ part: parts, id: commentIds });
    return response.items;
  }

  /**
   * Get replies to a comment
   */
  async getReplies(
    parentId: string,
    maxResults = 20,
    textFormat: 'html' | 'plainText' = 'plainText'
  ): Promise<ListResponse<Comment>> {
    return this.list({
      part: ['snippet'],
      parentId,
      maxResults,
      textFormat,
    });
  }

  /**
   * Insert (create) a comment (reply to a top-level comment)
   * Quota cost: 50 units
   */
  async insert(
    comment: Omit<Comment, 'kind' | 'etag' | 'id'>,
    params: CommentInsertParams
  ): Promise<Comment> {
    return this.client.post<Comment>(
      '/comments',
      comment as Record<string, unknown>,
      { part: params.part }
    );
  }

  /**
   * Reply to a comment
   */
  async reply(parentId: string, text: string): Promise<Comment> {
    return this.insert(
      {
        snippet: {
          parentId,
          textOriginal: text,
        },
      } as Omit<Comment, 'kind' | 'etag' | 'id'>,
      { part: ['snippet'] }
    );
  }

  /**
   * Update a comment
   * Quota cost: 50 units
   */
  async update(
    comment: Partial<Comment> & { id: string },
    params: CommentUpdateParams
  ): Promise<Comment> {
    return this.client.put<Comment>(
      '/comments',
      comment as Record<string, unknown>,
      { part: params.part }
    );
  }

  /**
   * Update comment text
   */
  async updateText(commentId: string, text: string): Promise<Comment> {
    return this.update(
      {
        id: commentId,
        snippet: {
          textOriginal: text,
        },
      } as Partial<Comment> & { id: string },
      { part: ['snippet'] }
    );
  }

  /**
   * Delete a comment
   * Quota cost: 50 units
   */
  async delete(commentId: string): Promise<void> {
    await this.client.delete('/comments', { id: commentId });
  }

  /**
   * Set comment moderation status
   * Quota cost: 50 units
   */
  async setModerationStatus(
    commentIds: string | string[],
    moderationStatus: ModerationStatus,
    banAuthor = false
  ): Promise<void> {
    await this.client.post('/comments/setModerationStatus', undefined, {
      id: commentIds,
      moderationStatus,
      banAuthor,
    });
  }

  /**
   * Mark comment as held for review
   */
  async holdForReview(commentIds: string | string[]): Promise<void> {
    await this.setModerationStatus(commentIds, 'heldForReview');
  }

  /**
   * Publish a comment (approve)
   */
  async publish(commentIds: string | string[]): Promise<void> {
    await this.setModerationStatus(commentIds, 'published');
  }

  /**
   * Reject a comment
   */
  async reject(commentIds: string | string[], banAuthor = false): Promise<void> {
    await this.setModerationStatus(commentIds, 'rejected', banAuthor);
  }

  /**
   * Mark as likely spam
   */
  async markAsSpam(commentIds: string | string[]): Promise<void> {
    await this.setModerationStatus(commentIds, 'likelySpam');
  }
}
