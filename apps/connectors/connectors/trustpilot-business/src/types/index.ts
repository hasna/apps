// Trustpilot Business Connector Types

export interface TrustpilotBusinessConfig {
  apiKey: string;
  apiSecret?: string;
  baseUrl?: string;
  invitationsBaseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export class TrustpilotBusinessApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'TrustpilotBusinessApiError';
  }
}

export interface Link {
  href?: string;
  method?: string;
  rel?: string;
}

export interface ReviewConsumer {
  id?: string;
  displayName?: string;
  displayLocation?: string;
  numberOfReviews?: number;
}

export interface Review {
  id?: string;
  stars?: number;
  title?: string;
  text?: string;
  language?: string;
  createdAt?: string;
  updatedAt?: string;
  isVerified?: boolean;
  status?: string;
  consumer?: ReviewConsumer;
  companyReply?: {
    text?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  links?: Link[];
}

export interface ReviewsListResponse {
  reviews?: Review[];
  links?: Link[];
  nextPageToken?: string;
}

export interface BusinessUnitName {
  identifying?: string;
  referring?: string[];
}

export interface BusinessUnitSummary {
  id?: string;
  displayName?: string;
  name?: BusinessUnitName;
  links?: Link[];
}

export interface BusinessUnitSearchResponse {
  businessUnits?: BusinessUnitSummary[];
  links?: Link[];
}

export interface WebhookSubscription {
  id?: string;
  url?: string;
  events?: string[];
}

export interface WebhooksListResponse {
  webhooks?: WebhookSubscription[];
}

export interface EmailInvitationRequest {
  replyTo?: string;
  locale?: string;
  senderName?: string;
  senderEmail?: string;
  locationId?: string;
  referenceNumber?: string;
  consumerName?: string;
  consumerEmail?: string;
  type?: string;
  serviceReviewInvitation?: {
    templateId?: string;
    preferredSendTime?: string;
    redirectUri?: string;
    tags?: string[];
  };
}

export interface InvitationLinkRequest {
  locationId?: string;
  referenceId?: string;
  email?: string;
  name?: string;
  locale?: string;
  tags?: string[];
  redirectUri?: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: string | number;
}
