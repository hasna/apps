/**
 * @hasna/connectors/social — stateless social transport SDK.
 *
 * Executes a normalized social operation purely from credentials passed in per call.
 * NO local config/token storage, NO fs, NO DB, NO src/lib/runner.ts, NO child_process.
 * Safe to bundle with `bun build --target bun` into a server bundle.
 *
 *   import { runSocialOperation } from "@hasna/connectors/social";
 *   await runSocialOperation({
 *     connector: "x",
 *     operation: "post.create",
 *     input: { text: "hello" },
 *     credentials: { apiKey, apiSecret, accessToken, oauth1AccessToken, oauth1AccessTokenSecret },
 *   });
 */
import { ConnectorOperationNotSupported } from "./errors";
import { XAdapter, type XCredentials } from "./x";
import { MastodonAdapter, type MastodonCredentials } from "./mastodon";
import { BlueskyAdapter, type BlueskyCredentials } from "./bluesky";
import { LinkedInAdapter, type LinkedInCredentials } from "./linkedin";
import { RedditAdapter, type RedditCredentials } from "./reddit";
import { TikTokAdapter, type TikTokCredentials } from "./tiktok";
import { YouTubeAdapter, type YouTubeCredentials } from "./youtube";
import { PinterestAdapter, type PinterestCredentials } from "./pinterest";
import {
  GoogleBusinessProfileAdapter,
  type GoogleBusinessProfileCredentials,
} from "./googlebusinessprofile";
import { FacebookAdapter, type FacebookCredentials } from "./facebook";
import { InstagramAdapter, type InstagramCredentials } from "./instagram";
import { ThreadsAdapter, type ThreadsCredentials } from "./threads";
import type {
  AnalyticsPostInput,
  MediaUploadInput,
  MentionsListInput,
  PostCreateInput,
  PostDeleteInput,
  SocialAdapter,
  SocialOperation,
} from "./types";

export { ConnectorOperationNotSupported } from "./errors";
export type {
  AccountMeResult,
  AnalyticsPostInput,
  AnalyticsPostResult,
  MediaUploadInput,
  MediaUploadResult,
  MentionItem,
  MentionsListInput,
  MentionsListResult,
  PostCreateInput,
  PostCreateResult,
  PostDeleteInput,
  PostDeleteResult,
  SocialConnectorSlug,
  SocialOperation,
} from "./types";

const SUPPORTED_CONNECTORS = [
  "x",
  "mastodon",
  "bluesky",
  "linkedin",
  "reddit",
  "tiktok",
  "youtube",
  "pinterest",
  "googlebusinessprofile",
  "facebook",
  "instagram",
  "threads",
] as const;

const ALL_OPS: SocialOperation[] = [
  "account.me",
  "post.create",
  "post.delete",
  "media.upload",
  "mentions.list",
  "analytics.post",
];

/**
 * Which normalized operations each connector EXPOSES. An op listed here may still
 * throw `ConnectorOperationNotSupported` at call time when the underlying network
 * genuinely cannot do it (e.g. X media.upload without OAuth 1.0a creds, TikTok
 * post.create without a video). Adapters own that runtime check; this map is the
 * coarse routing table.
 */
const SUPPORTED_OPERATIONS: Record<string, SocialOperation[]> = {
  // X media.upload requires OAuth 1.0a creds; it is exposed but throws
  // ConnectorOperationNotSupported at call time if those creds are absent.
  x: [...ALL_OPS],
  mastodon: [...ALL_OPS],
  // Bluesky (AT Protocol) has no first-class post analytics endpoint with
  // per-post metrics guaranteed; we expose aggregate counts from getPosts.
  bluesky: [...ALL_OPS],
  // LinkedIn member shares: no public mentions/analytics surface.
  linkedin: ["account.me", "post.create", "post.delete", "media.upload"],
  // Reddit: image upload uses an asset-lease flow not modeled here.
  reddit: ["account.me", "post.create", "post.delete", "mentions.list", "analytics.post"],
  // TikTok is video-only via the Content Posting API (no delete/mentions/analytics).
  tiktok: ["account.me", "post.create", "media.upload"],
  // YouTube is video-only via the Data API (no mentions).
  youtube: ["account.me", "post.create", "post.delete", "media.upload", "analytics.post"],
  // Pinterest: no mentions endpoint.
  pinterest: ["account.me", "post.create", "post.delete", "media.upload", "analytics.post"],
  // Google Business Profile localPosts: no mentions, no per-post analytics.
  googlebusinessprofile: ["account.me", "post.create", "post.delete", "media.upload"],
  // Facebook Pages feed: no first-class Page mentions edge modeled here.
  facebook: ["account.me", "post.create", "post.delete", "media.upload", "analytics.post"],
  // Instagram Graph: container→publish (media required); the API cannot delete
  // published media and has no mentions.list surface modeled here.
  instagram: ["account.me", "post.create", "media.upload", "analytics.post"],
  // Threads: text + reply chaining; mentions exposed but may throw at call time
  // if the account lacks the mentions edge.
  threads: ["account.me", "post.create", "post.delete", "media.upload", "mentions.list", "analytics.post"],
};

export interface RunSocialOperationArgs {
  connector: string;
  operation: string;
  input?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

/** List the social connector slugs supported by this SDK. */
export function listSocialConnectors(): string[] {
  return [...SUPPORTED_CONNECTORS];
}

/** List the normalized operations a connector implements. */
export function getSocialOperations(connector: string): string[] {
  const ops = SUPPORTED_OPERATIONS[connector];
  if (!ops) {
    throw new ConnectorOperationNotSupported(connector, "*");
  }
  return [...ops];
}

function buildAdapter(connector: string, credentials: Record<string, unknown>): SocialAdapter {
  switch (connector) {
    case "x":
      return XAdapter.fromCredentials(credentials as unknown as XCredentials);
    case "mastodon":
      return MastodonAdapter.fromCredentials(credentials as unknown as MastodonCredentials);
    case "bluesky":
      return BlueskyAdapter.fromCredentials(credentials as unknown as BlueskyCredentials);
    case "linkedin":
      return LinkedInAdapter.fromCredentials(credentials as unknown as LinkedInCredentials);
    case "reddit":
      return RedditAdapter.fromCredentials(credentials as unknown as RedditCredentials);
    case "tiktok":
      return TikTokAdapter.fromCredentials(credentials as unknown as TikTokCredentials);
    case "youtube":
      return YouTubeAdapter.fromCredentials(credentials as unknown as YouTubeCredentials);
    case "pinterest":
      return PinterestAdapter.fromCredentials(credentials as unknown as PinterestCredentials);
    case "googlebusinessprofile":
      return GoogleBusinessProfileAdapter.fromCredentials(
        credentials as unknown as GoogleBusinessProfileCredentials,
      );
    case "facebook":
      return FacebookAdapter.fromCredentials(credentials as unknown as FacebookCredentials);
    case "instagram":
      return InstagramAdapter.fromCredentials(credentials as unknown as InstagramCredentials);
    case "threads":
      return ThreadsAdapter.fromCredentials(credentials as unknown as ThreadsCredentials);
    default:
      throw new ConnectorOperationNotSupported(connector, "*");
  }
}

/**
 * Execute one normalized social operation. Stateless: all credentials are passed in.
 */
export async function runSocialOperation(args: RunSocialOperationArgs): Promise<unknown> {
  const { connector, operation, input = {}, credentials = {} } = args;

  if (!SUPPORTED_CONNECTORS.includes(connector as (typeof SUPPORTED_CONNECTORS)[number])) {
    throw new ConnectorOperationNotSupported(connector, operation);
  }

  const supported = SUPPORTED_OPERATIONS[connector] ?? [];
  if (!supported.includes(operation as SocialOperation)) {
    throw new ConnectorOperationNotSupported(connector, operation);
  }

  const adapter = buildAdapter(connector, credentials);

  switch (operation as SocialOperation) {
    case "account.me":
      return adapter.accountMe(input);
    case "post.create":
      return adapter.postCreate(input as unknown as PostCreateInput);
    case "post.delete":
      return adapter.postDelete(input as unknown as PostDeleteInput);
    case "media.upload":
      return adapter.mediaUpload(input as unknown as MediaUploadInput);
    case "mentions.list":
      return adapter.mentionsList(input as unknown as MentionsListInput);
    case "analytics.post":
      return adapter.analyticsPost(input as unknown as AnalyticsPostInput);
    default:
      throw new ConnectorOperationNotSupported(connector, operation);
  }
}
