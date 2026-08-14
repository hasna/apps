import type { TrustpilotBusinessClient } from './client';
import type {
  EmailInvitationRequest,
  InvitationLinkRequest,
  Review,
  ReviewsListResponse,
} from '../types';

export class ReviewsApi {
  constructor(private readonly client: TrustpilotBusinessClient) {}

  listReviews(
    businessUnitId: string,
    params?: {
      page?: number;
      perPage?: number;
      stars?: number[];
      language?: string[];
      orderBy?: string[];
      pageToken?: string;
      private?: boolean;
    },
  ): Promise<ReviewsListResponse> {
    const usePrivate = params?.private ?? false;
    const { private: _private, pageToken, ...queryParams } = params ?? {};

    if (usePrivate) {
      return this.client.get<ReviewsListResponse>(
        `/private/business-units/${encodeURIComponent(businessUnitId)}/reviews`,
        queryParams,
        { privateAuth: true },
      );
    }

    if (pageToken) {
      return this.client.get<ReviewsListResponse>(
        `/business-units/${encodeURIComponent(businessUnitId)}/all-reviews`,
        { pageToken },
      );
    }

    return this.client.get<ReviewsListResponse>(
      `/business-units/${encodeURIComponent(businessUnitId)}/reviews`,
      queryParams,
    );
  }

  getReview(reviewId: string, options?: { private?: boolean }): Promise<Review> {
    if (options?.private) {
      return this.client.get<Review>(
        `/private/reviews/${encodeURIComponent(reviewId)}`,
        undefined,
        { privateAuth: true },
      );
    }

    return this.client.get<Review>(`/reviews/${encodeURIComponent(reviewId)}`);
  }

  createEmailInvitation(
    businessUnitId: string,
    body: EmailInvitationRequest,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    return this.client.post(
      `/private/business-units/${encodeURIComponent(businessUnitId)}/email-invitations`,
      body,
      {
        baseUrl: this.client.getInvitationsBaseUrl(),
        privateAuth: true,
        headers,
      },
    );
  }

  createInvitationLink(
    businessUnitId: string,
    body: InvitationLinkRequest,
  ): Promise<{ id?: string; url?: string }> {
    return this.client.post(
      `/private/business-units/${encodeURIComponent(businessUnitId)}/invitation-links`,
      body,
      {
        baseUrl: this.client.getInvitationsBaseUrl(),
        privateAuth: true,
      },
    );
  }
}
