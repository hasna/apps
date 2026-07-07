// Sprout Social Connector Types
//
// Modeled on the public Sprout Social API (https://api.sproutsocial.com/docs/).
// The API is customer-scoped: most endpoints are nested under a numeric
// customer id (`/v1/{customer_id}/...`). Authentication is a Bearer access token.

// ============================================
// Configuration
// ============================================

export interface SproutSocialConfig {
  accessToken: string;
  /** Numeric customer id; required for every endpoint except `/metadata/client`. */
  customerId?: string | number;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface Paging {
  page?: number;
  total_pages?: number;
  next_cursor?: string;
}

export interface ListResponse<T> {
  data: T[];
  paging?: Paging;
}

// ============================================
// Metadata Types
// ============================================

export interface Client {
  customer_id: number;
  customer_name: string;
}

export type NetworkType =
  | 'twitter'
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'linkedin_company'
  | 'youtube'
  | 'pinterest'
  | 'tiktok'
  | 'threads'
  | string;

export interface CustomerProfile {
  customer_profile_id: number;
  network_type: NetworkType;
  name: string;
  native_name?: string;
  native_id?: string;
  link?: string;
  groups?: number[];
}

export interface Tag {
  tag_id: number;
  text: string;
  visible?: boolean;
  archived?: boolean;
}

export interface Group {
  group_id: number;
  name: string;
}

export interface User {
  id: number;
  name?: string;
  email?: string;
  active?: boolean;
}

export interface Topic {
  topic_id: string;
  name: string;
  theme?: string;
}

export interface Team {
  team_id: number;
  name: string;
  active?: boolean;
}

export interface Queue {
  queue_id: number;
  name: string;
  team_ids?: number[];
}

// ============================================
// Analytics Types
// ============================================

export interface AnalyticsFilter {
  /** Free-form filter expressions, e.g. `customer_profile_id.eq(123456)`. */
  filters?: string[];
  /** Metric names to return. */
  metrics?: string[];
  /** Dimension / field names to group by. */
  fields?: string[];
  /** Sort expressions, e.g. `impressions:desc`. */
  sort?: string[];
  /** 1-based page number. */
  page?: number;
  /** Page size (post analytics). */
  limit?: number;
  timezone?: string;
}

export interface AnalyticsDatum {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, number>;
  [key: string]: unknown;
}

export type AnalyticsResponse = ListResponse<AnalyticsDatum>;

// ============================================
// Message / Inbox Types
// ============================================

export interface MessageQuery {
  /** Free-form filter expressions; `customer_group_id` (group) is required. */
  filters?: string[];
  fields?: string[];
  metrics?: string[];
  sort?: string[];
  /** Cursor from a previous response's `paging.next_cursor`. */
  cursor?: string;
  limit?: number;
}

export interface Message {
  message_id?: string;
  customer_profile_id?: number;
  perma_link?: string;
  created_time?: string;
  text?: string;
  post_type?: string;
  from?: Record<string, unknown>;
  tags?: number[];
  [key: string]: unknown;
}

export type MessageResponse = ListResponse<Message>;

// ============================================
// Publishing Types
// ============================================

export interface PublishingMedia {
  media_id?: number;
  url?: string;
  alt_text?: string;
}

export interface CreatePublishingPostParams {
  group_id: number;
  customer_profile_ids: number[];
  text: string;
  /** The public API only permits draft creation; defaults to true. */
  is_draft?: boolean;
  media?: PublishingMedia[];
  tag_ids?: number[];
  delivery?: Record<string, unknown>;
}

export interface PublishingPost {
  publishing_post_id?: string;
  customer_profile_id?: number;
  group_id?: number;
  text?: string;
  is_draft?: boolean;
  status?: string;
  [key: string]: unknown;
}

export type PublishingPostResponse = ListResponse<PublishingPost>;

// ============================================
// Cases Types
// ============================================

export interface CaseQuery {
  filters?: string[];
  fields?: string[];
  sort?: string[];
  cursor?: string;
  limit?: number;
}

export interface Case {
  case_id?: number;
  status?: string;
  priority?: string;
  type?: string;
  queue_id?: number;
  message_id?: string;
  assigned_to?: number;
  created_time?: string;
  [key: string]: unknown;
}

export type CaseResponse = ListResponse<Case>;

// ============================================
// Media Upload Types
// ============================================

export interface MediaUploadParams {
  /** Remote URL for Sprout to download the asset from. */
  url?: string;
  alt_text?: string;
}

export interface MediaUploadResponse {
  media_id?: number;
  status?: string;
  [key: string]: unknown;
}

// ============================================
// API Error Types
// ============================================

export interface SproutSocialErrorResponse {
  error?: string;
  message?: string;
  code?: number | string;
  errors?: Array<{ message?: string; code?: string }>;
}

export class SproutSocialApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: number | string;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, code?: number | string, details?: unknown) {
    super(message);
    this.name = 'SproutSocialApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
