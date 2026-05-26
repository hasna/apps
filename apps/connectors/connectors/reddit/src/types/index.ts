// Reddit Connector Types

// ============================================
// Configuration
// ============================================

export interface RedditConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  userAgent?: string;
}

export interface RedditCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: number;
  scope: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  after?: string;
  before?: string;
  hasMore: boolean;
}

export type VoteDirection = 1 | 0 | -1; // 1=upvote, 0=unvote, -1=downvote

// ============================================
// Post Types
// ============================================

export interface RedditPost {
  id: string;
  name: string; // fullname (t3_xxx)
  title: string;
  author: string;
  subreddit: string;
  subredditNamePrefixed: string;
  selftext?: string;
  selftextHtml?: string;
  url: string;
  permalink: string;
  thumbnail?: string;
  score: number;
  upvoteRatio?: number;
  numComments: number;
  created: number;
  createdUtc: number;
  isNsfw: boolean;
  isSpoiler: boolean;
  isStickied: boolean;
  isLocked: boolean;
  isSelf: boolean;
  isVideo: boolean;
  domain: string;
  flair?: string;
  likes?: boolean | null; // true=upvoted, false=downvoted, null=no vote
}

export interface SubmitPostOptions {
  subreddit: string;
  title: string;
  kind: 'self' | 'link' | 'image' | 'video' | 'videogif';
  text?: string;
  url?: string;
  nsfw?: boolean;
  spoiler?: boolean;
  flairId?: string;
  flairText?: string;
  sendReplies?: boolean;
}

export interface SubmitPostResponse {
  id: string;
  name: string;
  url: string;
}

// ============================================
// Comment Types
// ============================================

export interface RedditComment {
  id: string;
  name: string; // fullname (t1_xxx)
  author: string;
  body: string;
  bodyHtml?: string;
  score: number;
  created: number;
  createdUtc: number;
  parentId: string;
  linkId: string;
  subreddit: string;
  isSubmitter: boolean;
  edited: boolean | number;
  stickied: boolean;
  scoreHidden: boolean;
  depth: number;
  replies?: RedditComment[];
  likes?: boolean | null;
}

export interface SubmitCommentOptions {
  parentFullname: string; // t1_xxx for comment reply, t3_xxx for post reply
  text: string;
}

// ============================================
// Subreddit Types
// ============================================

export interface Subreddit {
  id: string;
  name: string;
  displayName: string;
  displayNamePrefixed: string;
  title: string;
  publicDescription?: string;
  description?: string;
  subscribers: number;
  activeUserCount?: number;
  created: number;
  createdUtc: number;
  url: string;
  isNsfw: boolean;
  subredditType: 'public' | 'private' | 'restricted' | 'gold_restricted' | 'archived';
  userIsSubscriber?: boolean;
  userIsModerator?: boolean;
  iconImg?: string;
  bannerImg?: string;
}

export interface SubredditRules {
  subreddit: string;
  rules: {
    kind: string;
    shortName: string;
    description: string;
    violationReason: string;
    createdUtc: number;
    priority: number;
  }[];
}

// ============================================
// User Types
// ============================================

export interface RedditUser {
  id: string;
  name: string;
  created: number;
  createdUtc: number;
  linkKarma: number;
  commentKarma: number;
  totalKarma: number;
  awardeeKarma: number;
  awarderKarma: number;
  iconImg?: string;
  isGold: boolean;
  isMod: boolean;
  isEmployee: boolean;
  hasVerifiedEmail: boolean;
  subreddit?: {
    displayName: string;
    title: string;
    publicDescription: string;
    subscribers: number;
  };
}

export interface UserTrophies {
  trophies: {
    name: string;
    description?: string;
    awardId?: string;
    icon40?: string;
    icon70?: string;
    grantedAt?: number;
  }[];
}

// ============================================
// Search Types
// ============================================

export interface SearchOptions {
  query: string;
  subreddit?: string;
  sort?: 'relevance' | 'hot' | 'top' | 'new' | 'comments';
  time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
  type?: 'link' | 'sr' | 'user';
  limit?: number;
  after?: string;
  before?: string;
  restrictSr?: boolean;
}

export interface SearchResults {
  posts: RedditPost[];
  subreddits?: Subreddit[];
  after?: string;
  before?: string;
}

// ============================================
// Feed Types
// ============================================

export type FeedSort = 'hot' | 'new' | 'rising' | 'top' | 'controversial' | 'best';
export type TimeFilter = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';

export interface FeedOptions {
  sort?: FeedSort;
  time?: TimeFilter;
  limit?: number;
  after?: string;
  before?: string;
}

// ============================================
// Message Types
// ============================================

export interface RedditMessage {
  id: string;
  name: string;
  author: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  created: number;
  createdUtc: number;
  context?: string;
  isNew: boolean;
  wasComment: boolean;
  parentId?: string;
  firstMessageName?: string;
  replies?: RedditMessage[];
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class RedditApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly details?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, code?: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'RedditApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// ============================================
// OAuth Types
// ============================================

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export interface OAuthState {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  state: string;
  scope: string[];
}
