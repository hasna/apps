import { TrustpilotBusinessClient } from './client';
import { ReviewsApi } from './reviews';
import { EventsApi } from './events';
import { SearchApi } from './search';
import type {
  EmailInvitationRequest,
  InvitationLinkRequest,
  TrustpilotBusinessConfig,
} from '../types';

export { TrustpilotBusinessClient } from './client';
export { ReviewsApi } from './reviews';
export { EventsApi } from './events';
export { SearchApi } from './search';

export class TrustpilotBusiness {
  private readonly client: TrustpilotBusinessClient;
  readonly reviews: ReviewsApi;
  readonly events: EventsApi;
  readonly search: SearchApi;

  constructor(config: TrustpilotBusinessConfig) {
    this.client = new TrustpilotBusinessClient(config);
    this.reviews = new ReviewsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  listReviews(...args: Parameters<ReviewsApi['listReviews']>) {
    return this.reviews.listReviews(...args);
  }

  getReview(...args: Parameters<ReviewsApi['getReview']>) {
    return this.reviews.getReview(...args);
  }

  createEmailInvitation(...args: Parameters<ReviewsApi['createEmailInvitation']>) {
    return this.reviews.createEmailInvitation(...args);
  }

  createInvitationLink(...args: Parameters<ReviewsApi['createInvitationLink']>) {
    return this.reviews.createInvitationLink(...args);
  }

  listEvents(...args: Parameters<EventsApi['listWebhooks']>) {
    return this.events.listWebhooks(...args);
  }

  searchBusinessUnits(...args: Parameters<SearchApi['searchBusinessUnits']>) {
    return this.search.searchBusinessUnits(...args);
  }

  findBusinessUnit(...args: Parameters<SearchApi['findBusinessUnit']>) {
    return this.search.findBusinessUnit(...args);
  }

  async rawRequest(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      query?: Record<string, string | number | boolean | undefined | string[]>;
      body?: Record<string, unknown> | string;
      headers?: Record<string, string>;
      baseUrl?: string;
      privateAuth?: boolean;
    } = {},
  ): Promise<unknown> {
    return this.client.request(path, {
      method: options.method ?? 'GET',
      params: options.query,
      body: options.body,
      headers: options.headers,
      baseUrl: options.baseUrl,
      privateAuth: options.privateAuth,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export type {
  EmailInvitationRequest,
  InvitationLinkRequest,
  TrustpilotBusinessConfig,
};
