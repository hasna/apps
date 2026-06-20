/**
 * Normalized, network-agnostic types for the stateless social transport SDK.
 *
 * These types are intentionally self-contained: the public `@hasna/connectors/social`
 * surface must NOT leak connector-internal types. Everything here is plain data so the
 * entry point stays bundle-safe (no fs/db/runner imports).
 */

/** Slugs supported by this deliverable. */
export type SocialConnectorSlug = "x" | "mastodon" | "bluesky";

/** Normalized operation names. */
export type SocialOperation =
  | "account.me"
  | "post.create"
  | "post.delete"
  | "media.upload"
  | "mentions.list"
  | "analytics.post";

export interface AccountMeResult {
  id: string;
  username?: string;
  displayName?: string;
  url?: string;
}

export interface PostCreateInput {
  text: string;
  replyToId?: string;
  mediaIds?: string[];
}

export interface PostCreateResult {
  id: string;
  url?: string;
}

export interface PostDeleteInput {
  id: string;
}

export interface PostDeleteResult {
  id: string;
  deleted: boolean;
}

export interface MediaUploadInput {
  dataBase64: string;
  mimeType: string;
  altText?: string;
}

export interface MediaUploadResult {
  mediaId: string;
}

export interface MentionsListInput {
  sinceId?: string;
  limit?: number;
}

export interface MentionItem {
  id: string;
  text: string;
  authorId?: string;
  authorHandle?: string;
  createdAt?: string;
}

export interface MentionsListResult {
  items: MentionItem[];
}

export interface AnalyticsPostInput {
  id: string;
}

export interface AnalyticsPostResult {
  metrics: Record<string, number>;
}

/**
 * A connector adapter: maps each normalized operation onto a network's transport.
 * Credentials are caller-owned and passed in per construction — no local storage.
 */
export interface SocialAdapter {
  accountMe(input?: Record<string, unknown>): Promise<AccountMeResult>;
  postCreate(input: PostCreateInput): Promise<PostCreateResult>;
  postDelete(input: PostDeleteInput): Promise<PostDeleteResult>;
  mediaUpload(input: MediaUploadInput): Promise<MediaUploadResult>;
  mentionsList(input?: MentionsListInput): Promise<MentionsListResult>;
  analyticsPost(input: AnalyticsPostInput): Promise<AnalyticsPostResult>;
}
