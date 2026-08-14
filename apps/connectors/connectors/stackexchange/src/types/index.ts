export type OutputFormat = 'json' | 'pretty' | 'table';

/** Sort direction accepted by the Stack Exchange API. */
export type SortOrder = 'asc' | 'desc';

/**
 * Credentials / defaults for the client. Everything is optional — the public
 * read endpoints work unauthenticated, an app key simply raises the quota.
 */
export interface StackExchangeConfig {
  /** Application key for a higher request quota. */
  key?: string;
  /** OAuth access token for authenticated / per-user endpoints. */
  accessToken?: string;
  /** Default site slug (e.g. "stackoverflow"). Defaults to "stackoverflow". */
  site?: string;
  /** Override the API base URL (defaults to the public v2.3 endpoint). */
  baseUrl?: string;
}

/** A trimmed-down user object as embedded in questions/answers. */
export interface ShallowUser {
  user_id?: number;
  display_name: string;
  reputation?: number;
  user_type?: string;
  link?: string;
  profile_image?: string;
}

export interface Question {
  question_id: number;
  title: string;
  link: string;
  score: number;
  answer_count: number;
  view_count: number;
  is_answered: boolean;
  accepted_answer_id?: number;
  tags: string[];
  creation_date: number;
  last_activity_date: number;
  owner?: ShallowUser;
  body?: string;
}

export interface Answer {
  answer_id: number;
  question_id: number;
  score: number;
  is_accepted: boolean;
  creation_date: number;
  last_activity_date: number;
  owner?: ShallowUser;
  link?: string;
  title?: string;
  body?: string;
}

export interface User {
  user_id: number;
  display_name: string;
  reputation: number;
  link: string;
  user_type?: string;
  location?: string;
  website_url?: string;
  creation_date: number;
  badge_counts?: { gold: number; silver: number; bronze: number };
}

export interface Tag {
  name: string;
  count: number;
  has_synonyms: boolean;
  is_moderator_only: boolean;
  is_required: boolean;
}

/** The common wrapper the Stack Exchange API returns around every list. */
export interface Wrapper<T> {
  items: T[];
  has_more: boolean;
  quota_max: number;
  quota_remaining: number;
  page?: number;
  page_size?: number;
  total?: number;
  backoff?: number;
}

/** Options shared by every paginated list endpoint. */
export interface PageOptions {
  page?: number;
  pageSize?: number;
  order?: SortOrder;
  sort?: string;
  site?: string;
}

export interface SearchOptions extends PageOptions {
  /** Free-text query (maps to the `q` parameter of /search/advanced). */
  query?: string;
  /** Match text in the title only. */
  inTitle?: string;
  /** Restrict to questions with all of these tags. */
  tagged?: string[];
  /** Only questions with an accepted answer. */
  accepted?: boolean;
  /** Only questions with zero answers. */
  noAnswers?: boolean;
}

/** Raw error payload returned by the API inside a 4xx/5xx wrapper. */
export interface ApiErrorBody {
  error_id: number;
  error_name: string;
  error_message: string;
}

export class StackExchangeApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorId?: number,
    public errorName?: string,
  ) {
    super(message);
    this.name = 'StackExchangeApiError';
  }
}
