import type { TrustpilotClient } from './client';
import type {
  PrivateBusinessUnitReviewsOptions,
  ReviewReplyOptions,
  ReviewReportOptions,
} from '../types';

export class ReviewsApi {
  constructor(private readonly client: TrustpilotClient) {}

  async get(reviewId: string): Promise<unknown> {
    return this.client.get(`/reviews/${encodeURIComponent(reviewId)}`, undefined, 'apikey');
  }

  async reply(options: ReviewReplyOptions): Promise<unknown> {
    return this.client.post(`/private/reviews/${encodeURIComponent(options.reviewId)}/reply`, {
      message: options.message,
    });
  }

  async deleteReply(reviewId: string): Promise<unknown> {
    return this.client.delete(`/private/reviews/${encodeURIComponent(reviewId)}/reply`);
  }

  async report(options: ReviewReportOptions): Promise<unknown> {
    return this.client.post(`/private/reviews/${encodeURIComponent(options.reviewId)}/report`, {
      reason: options.reason,
      explanation: options.explanation,
    });
  }

  async listPrivate(options: PrivateBusinessUnitReviewsOptions): Promise<unknown> {
    return this.client.get(`/private/business-units/${encodeURIComponent(options.businessUnitId)}/reviews`, {
      perPage: options.perPage,
      page: options.page,
      stars: options.stars,
      startDateTime: options.startDateTime,
      endDateTime: options.endDateTime,
      orderBy: options.orderBy,
      responded: options.responded,
      language: options.language,
    });
  }
}
