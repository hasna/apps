import type { StageClient } from './client';
import type { Review, Chapter, ReviewComment, StageList } from '../types';

export interface ListReviewsOptions {
  status?: string;
  repository?: string;
  author?: string;
  limit?: number;
  cursor?: string;
}

export interface CreateCommentOptions {
  reviewId: string;
  body: string;
  path?: string;
  line?: number;
}

/**
 * Stage Reviews API
 *
 * Covers structured code reviews, their chapters and comments.
 */
export class ReviewsApi {
  constructor(private readonly client: StageClient) {}

  /**
   * List reviews.
   * GET /reviews
   */
  async list(options: ListReviewsOptions = {}): Promise<StageList<Review>> {
    return this.client.request<StageList<Review>>('/reviews', {
      method: 'GET',
      query: {
        status: options.status,
        repository: options.repository,
        author: options.author,
        limit: options.limit,
        cursor: options.cursor,
      },
    });
  }

  /**
   * Get a single review by id.
   * GET /reviews/{reviewId}
   */
  async get(reviewId: string): Promise<Review> {
    return this.client.request<Review>(`/reviews/${encodeURIComponent(reviewId)}`, {
      method: 'GET',
    });
  }

  /**
   * List the chapters of a review.
   * GET /reviews/{reviewId}/chapters
   */
  async listChapters(reviewId: string): Promise<StageList<Chapter>> {
    return this.client.request<StageList<Chapter>>(
      `/reviews/${encodeURIComponent(reviewId)}/chapters`,
      { method: 'GET' }
    );
  }

  /**
   * Create a comment on a review.
   * POST /reviews/{reviewId}/comments
   */
  async createComment(options: CreateCommentOptions): Promise<ReviewComment> {
    return this.client.request<ReviewComment>(
      `/reviews/${encodeURIComponent(options.reviewId)}/comments`,
      {
        method: 'POST',
        body: {
          body: options.body,
          path: options.path,
          line: options.line,
        },
      }
    );
  }
}
