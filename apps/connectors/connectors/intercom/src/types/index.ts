// Intercom Connector Types

// ============================================
// Configuration
// ============================================

export interface IntercomConfig {
  accessToken: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  type: string;
  data: T[];
  total_count?: number;
  pages?: {
    type: string;
    next?: {
      page: number;
      starting_after?: string;
    };
    page: number;
    per_page: number;
    total_pages: number;
  };
}

// ============================================
// Contact Types
// ============================================

export type ContactRole = 'user' | 'lead';

export interface Contact {
  type: 'contact';
  id: string;
  workspace_id: string;
  external_id?: string;
  role: ContactRole;
  email?: string;
  phone?: string;
  name?: string;
  avatar?: string;
  owner_id?: number;
  social_profiles?: {
    type: string;
    data: SocialProfile[];
  };
  has_hard_bounced: boolean;
  marked_email_as_spam: boolean;
  unsubscribed_from_emails: boolean;
  created_at: number;
  updated_at: number;
  signed_up_at?: number;
  last_seen_at?: number;
  last_replied_at?: number;
  last_contacted_at?: number;
  last_email_opened_at?: number;
  last_email_clicked_at?: number;
  language_override?: string;
  browser?: string;
  browser_version?: string;
  browser_language?: string;
  os?: string;
  location?: ContactLocation;
  android_app_name?: string;
  android_app_version?: string;
  android_device?: string;
  android_os_version?: string;
  android_sdk_version?: string;
  android_last_seen_at?: number;
  ios_app_name?: string;
  ios_app_version?: string;
  ios_device?: string;
  ios_os_version?: string;
  ios_sdk_version?: string;
  ios_last_seen_at?: number;
  custom_attributes?: Record<string, unknown>;
  tags?: {
    type: string;
    data: TagReference[];
  };
  notes?: {
    type: string;
    data: NoteReference[];
  };
  companies?: {
    type: string;
    data: CompanyReference[];
  };
}

export interface SocialProfile {
  type: string;
  name: string;
  url: string;
}

export interface ContactLocation {
  type: string;
  country?: string;
  region?: string;
  city?: string;
  country_code?: string;
  continent_code?: string;
}

export interface TagReference {
  type: 'tag';
  id: string;
  url: string;
}

export interface NoteReference {
  type: 'note';
  id: string;
  url: string;
}

export interface CompanyReference {
  type: 'company';
  id: string;
  url: string;
}

export interface ContactListResponse extends PaginatedResponse<Contact> {
  type: 'list';
}

export interface ContactCreateParams {
  role?: ContactRole;
  external_id?: string;
  email?: string;
  phone?: string;
  name?: string;
  avatar?: string;
  signed_up_at?: number;
  last_seen_at?: number;
  owner_id?: number;
  unsubscribed_from_emails?: boolean;
  custom_attributes?: Record<string, unknown>;
}

export interface ContactUpdateParams {
  role?: ContactRole;
  external_id?: string;
  email?: string;
  phone?: string;
  name?: string;
  avatar?: string;
  signed_up_at?: number;
  last_seen_at?: number;
  owner_id?: number;
  unsubscribed_from_emails?: boolean;
  custom_attributes?: Record<string, unknown>;
}

export interface ContactSearchParams {
  query: ContactSearchQuery;
  pagination?: {
    per_page?: number;
    starting_after?: string;
  };
}

export interface ContactSearchQuery {
  field?: string;
  operator?: 'AND' | 'OR' | '=' | '!=' | 'IN' | 'NIN' | '<' | '>' | '~' | '!~' | '^' | '$';
  value?: string | number | boolean | string[];
  queries?: ContactSearchQuery[];
}

// ============================================
// Conversation Types
// ============================================

export type ConversationState = 'open' | 'closed' | 'snoozed';

export interface Conversation {
  type: 'conversation';
  id: string;
  title?: string;
  created_at: number;
  updated_at: number;
  waiting_since?: number;
  snoozed_until?: number;
  open: boolean;
  state: ConversationState;
  read: boolean;
  priority: 'priority' | 'not_priority';
  admin_assignee_id?: number;
  team_assignee_id?: string;
  tags?: {
    type: string;
    tags: Tag[];
  };
  conversation_rating?: ConversationRating;
  source: ConversationSource;
  contacts?: {
    type: string;
    contacts: ContactReference[];
  };
  teammates?: {
    type: string;
    admins: AdminReference[];
  };
  first_contact_reply?: {
    created_at: number;
    type: string;
    url?: string;
  };
  sla_applied?: SlaApplied;
  statistics?: ConversationStatistics;
  conversation_parts?: {
    type: string;
    conversation_parts: ConversationPart[];
    total_count: number;
  };
  custom_attributes?: Record<string, unknown>;
}

export interface ConversationRating {
  rating: number;
  remark?: string;
  created_at: number;
  contact: ContactReference;
  teammate?: AdminReference;
}

export interface ConversationSource {
  type: string;
  id: string;
  delivered_as: string;
  subject?: string;
  body: string;
  author: Author;
  attachments?: Attachment[];
  url?: string;
  redacted: boolean;
}

export interface Author {
  type: string;
  id: string;
  name?: string;
  email?: string;
}

export interface Attachment {
  type: string;
  name: string;
  url: string;
  content_type: string;
  filesize: number;
  width?: number;
  height?: number;
}

export interface ContactReference {
  type: 'contact';
  id: string;
  external_id?: string;
}

export interface AdminReference {
  type: 'admin';
  id: string;
}

export interface SlaApplied {
  type: string;
  sla_name: string;
  sla_status: 'hit' | 'missed' | 'cancelled' | 'active';
}

export interface ConversationStatistics {
  type: string;
  time_to_assignment?: number;
  time_to_admin_reply?: number;
  time_to_first_close?: number;
  time_to_last_close?: number;
  median_time_to_reply?: number;
  first_contact_reply_at?: number;
  first_assignment_at?: number;
  first_admin_reply_at?: number;
  first_close_at?: number;
  last_assignment_at?: number;
  last_assignment_admin_reply_at?: number;
  last_contact_reply_at?: number;
  last_admin_reply_at?: number;
  last_close_at?: number;
  last_closed_by_id?: string;
  count_reopens?: number;
  count_assignments?: number;
  count_conversation_parts?: number;
}

export interface ConversationPart {
  type: 'conversation_part';
  id: string;
  part_type: string;
  body?: string;
  created_at: number;
  updated_at: number;
  notified_at: number;
  assigned_to?: AdminReference;
  author: Author;
  attachments?: Attachment[];
  external_id?: string;
  redacted: boolean;
}

export interface ConversationListResponse extends PaginatedResponse<Conversation> {
  type: 'conversation.list';
}

export interface ConversationReplyParams {
  message_type: 'comment' | 'note';
  type: 'admin' | 'user';
  body: string;
  admin_id?: string;
  intercom_user_id?: string;
  user_id?: string;
  email?: string;
  attachment_urls?: string[];
}

export interface ConversationSearchParams {
  query: ContactSearchQuery;
  pagination?: {
    per_page?: number;
    starting_after?: string;
  };
}

// ============================================
// Company Types
// ============================================

export interface Company {
  type: 'company';
  id: string;
  company_id?: string;
  name?: string;
  app_id?: string;
  plan?: {
    type: string;
    id: string;
    name: string;
  };
  remote_created_at?: number;
  created_at: number;
  updated_at: number;
  last_request_at?: number;
  size?: number;
  website?: string;
  industry?: string;
  monthly_spend?: number;
  session_count?: number;
  user_count?: number;
  tags?: {
    type: string;
    tags: Tag[];
  };
  segments?: {
    type: string;
    segments: Segment[];
  };
  custom_attributes?: Record<string, unknown>;
}

export interface Segment {
  type: 'segment';
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  person_type: 'user' | 'lead' | 'contact';
  count?: number;
}

export interface CompanyListResponse extends PaginatedResponse<Company> {
  type: 'list';
}

export interface CompanyCreateParams {
  company_id?: string;
  name?: string;
  plan?: string;
  remote_created_at?: number;
  size?: number;
  website?: string;
  industry?: string;
  monthly_spend?: number;
  custom_attributes?: Record<string, unknown>;
}

// ============================================
// Tag Types
// ============================================

export interface Tag {
  type: 'tag';
  id: string;
  name: string;
  applied_at?: number;
  applied_by?: AdminReference;
}

export interface TagListResponse {
  type: 'list';
  data: Tag[];
}

export interface TagCreateParams {
  name: string;
}

// ============================================
// Admin Types
// ============================================

export interface Admin {
  type: 'admin';
  id: string;
  name?: string;
  email: string;
  job_title?: string;
  away_mode_enabled: boolean;
  away_mode_reassign: boolean;
  has_inbox_seat: boolean;
  team_ids?: string[];
  avatar?: {
    type: string;
    image_url?: string;
  };
}

export interface AdminListResponse {
  type: 'admin.list';
  admins: Admin[];
}

// ============================================
// Team Types
// ============================================

export interface Team {
  type: 'team';
  id: string;
  name: string;
  admin_ids?: string[];
  admin_priority_level?: {
    primary_admin_ids?: string[];
    secondary_admin_ids?: string[];
  };
}

export interface TeamListResponse {
  type: 'team.list';
  teams: Team[];
}

// ============================================
// Data Event Types
// ============================================

export interface DataEvent {
  type: 'event';
  event_name: string;
  created_at: number;
  user_id?: string;
  intercom_user_id?: string;
  email?: string;
  metadata?: Record<string, unknown>;
}

export interface DataEventCreateParams {
  event_name: string;
  created_at?: number;
  user_id?: string;
  id?: string;
  email?: string;
  metadata?: Record<string, unknown>;
}

export interface DataEventListResponse {
  type: 'event.list';
  events: DataEvent[];
  pages?: {
    next?: string;
    since?: string;
  };
}

// ============================================
// Article Types
// ============================================

export type ArticleState = 'published' | 'draft';

export interface Article {
  type: 'article';
  id: string;
  workspace_id: string;
  title: string;
  description?: string;
  body: string;
  author_id: number;
  state: ArticleState;
  created_at: number;
  updated_at: number;
  url?: string;
  parent_id?: number;
  parent_ids?: number[];
  parent_type?: string;
  default_locale: string;
  translated_content?: {
    type: string;
    [locale: string]: ArticleTranslation | string;
  };
  statistics?: {
    type: string;
    views: number;
    conversions: number;
    reactions: number;
    happy_reaction_percentage: number;
    neutral_reaction_percentage: number;
    sad_reaction_percentage: number;
  };
}

export interface ArticleTranslation {
  type: string;
  title?: string;
  description?: string;
  body?: string;
  author_id?: number;
  state?: ArticleState;
  created_at?: number;
  updated_at?: number;
  url?: string;
}

export interface ArticleListResponse extends PaginatedResponse<Article> {
  type: 'list';
}

export interface ArticleCreateParams {
  title: string;
  description?: string;
  body: string;
  author_id: number;
  state?: ArticleState;
  parent_id?: number;
  parent_type?: string;
  translated_content?: Record<string, {
    title?: string;
    description?: string;
    body?: string;
    author_id?: number;
    state?: ArticleState;
  }>;
}

// ============================================
// Note Types
// ============================================

export interface Note {
  type: 'note';
  id: string;
  created_at: number;
  contact?: ContactReference;
  author?: Author;
  body: string;
}

export interface NoteCreateParams {
  body: string;
  contact_id: string;
  admin_id?: string;
}

// ============================================
// Message Types (for creating outbound messages)
// ============================================

export interface Message {
  type: 'user_message' | 'admin_message';
  id: string;
  created_at: number;
  body: string;
  message_type: 'email' | 'inapp' | 'facebook' | 'twitter' | 'push';
  conversation_id?: string;
}

export interface MessageCreateParams {
  message_type: 'email' | 'inapp';
  subject?: string;
  body: string;
  template?: 'plain' | 'personal';
  from: {
    type: 'admin' | 'bot';
    id?: string;
  };
  to: {
    type: 'user' | 'lead' | 'contact';
    id?: string;
    user_id?: string;
    email?: string;
  };
  create_conversation_without_contact_reply?: boolean;
}

// ============================================
// API Error Types
// ============================================

export interface IntercomErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export interface IntercomErrorResponse {
  type: 'error.list';
  request_id?: string;
  errors: IntercomErrorDetail[];
}

export class IntercomApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: IntercomErrorDetail[];
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, errors?: IntercomErrorDetail[], requestId?: string) {
    super(message);
    this.name = 'IntercomApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.requestId = requestId;
  }
}
