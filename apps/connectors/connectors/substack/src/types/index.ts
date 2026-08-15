// Substack Connector Types

// ============================================
// Configuration
// ============================================

export interface SubstackConfig {
  subdomain: string;
  token: string; // Session token from browser cookies (substack.sid)
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'yaml' | 'pretty';

export type PostType = 'newsletter' | 'podcast' | 'thread';

export type PostAudience = 'everyone' | 'only_paid' | 'only_free' | 'founding';

// ============================================
// Post Types
// ============================================

export interface PostAuthor {
  id: number;
  name: string;
  handle?: string;
  photo_url?: string;
  bio?: string;
}

export interface Post {
  id: number;
  publication_id: number;
  title: string;
  subtitle?: string;
  slug: string;
  type: PostType;
  audience: PostAudience;
  canonical_url: string;
  post_date?: string;
  publish_date?: string;
  draft?: boolean;
  is_published: boolean;
  word_count?: number;
  email_sent_at?: string;
  reaction_count?: number;
  comment_count?: number;
  restacked_post_count?: number;
  description?: string;
  body_html?: string;
  body_markdown?: string;
  truncated_body_text?: string;
  cover_image?: string;
  podcast_url?: string;
  podcast_duration?: number;
  video_upload_id?: string;
  write_comment_permissions?: string;
  section_id?: number;
  top_exclusion?: string;
  pins?: unknown[];
  section_pins?: unknown[];
  default_comment_sort?: string;
  publishedBylines?: PostAuthor[];
}

export interface PostListResponse {
  posts: Post[];
  more: boolean;
  offset?: number;
  limit?: number;
}

export interface CreatePostRequest {
  title: string;
  subtitle?: string;
  body_markdown?: string;
  body_html?: string;
  audience?: PostAudience;
  type?: PostType;
  section_id?: number;
  draft?: boolean;
}

export interface PublishPostRequest {
  send?: boolean; // Send email to subscribers
}

// ============================================
// Subscriber Types
// ============================================

export interface Subscriber {
  id: number;
  email: string;
  name?: string;
  subscription_type: 'free' | 'paid' | 'comp' | 'gift';
  created_at: string;
  is_gift?: boolean;
  expiry_date?: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  stripe_connected_account_id?: string;
  subscription_id?: number;
  user_id?: number;
}

export interface SubscriberStats {
  total_subscribers: number;
  free_subscribers: number;
  paid_subscribers: number;
  comp_subscribers: number;
  total_email_opens: number;
  average_open_rate: number;
}

export interface SubscriberListResponse {
  subscribers: Subscriber[];
  more: boolean;
  offset?: number;
  limit?: number;
}

// ============================================
// Comment Types
// ============================================

export interface CommentAuthor {
  id: number;
  name: string;
  handle?: string;
  photo_url?: string;
  is_author?: boolean;
}

export interface Comment {
  id: number;
  post_id: number;
  body: string;
  body_json?: unknown;
  edited_at?: string;
  name: string;
  user_id?: number;
  date: string;
  reaction_count?: number;
  deleted?: boolean;
  ancestor_path?: string;
  children?: Comment[];
  author?: CommentAuthor;
}

export interface CommentListResponse {
  comments: Comment[];
  more: boolean;
}

// ============================================
// Stats Types
// ============================================

export interface PublicationStats {
  total_subscribers: number;
  free_subscribers: number;
  paid_subscribers: number;
  total_posts: number;
  total_views: number;
  total_email_opens: number;
  total_reactions: number;
  subscriber_growth?: SubscriberGrowth[];
}

export interface SubscriberGrowth {
  date: string;
  free_signups: number;
  paid_signups: number;
  cancellations: number;
  net_growth: number;
}

export interface PostStats {
  post_id: number;
  views: number;
  email_opens: number;
  email_open_rate: number;
  reactions: number;
  comments: number;
  restacks: number;
}

// ============================================
// Publication/Profile Types
// ============================================

export interface Publication {
  id: number;
  subdomain: string;
  name: string;
  custom_domain?: string;
  custom_domain_optional?: boolean;
  logo_url?: string;
  hero_image?: string;
  author_id: number;
  copyright?: string;
  created_at: string;
  language?: string;
  email_from_name?: string;
  email_banner_url?: string;
  community_enabled?: boolean;
  invite_only?: boolean;
  default_write_comment_permissions?: string;
  author?: PublicationAuthor;
  subscriber_count?: number;
  post_count?: number;
  paid_subscriber_count?: number;
  free_subscriber_count?: number;
  homepage_type?: string;
  about_page_id?: number;
  default_group_coupon_percent_off?: number;
  twitter_share_type?: string;
  founding_subscribers_enabled?: boolean;
  default_show_guest_bios?: boolean;
  apple_pay_disabled?: boolean;
}

export interface PublicationAuthor {
  id: number;
  name: string;
  handle?: string;
  photo_url?: string;
  bio?: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class SubstackApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, code?: string, requestId?: string) {
    super(message);
    this.name = 'SubstackApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
  }
}
