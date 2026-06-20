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

const SUPPORTED_CONNECTORS = ["x", "mastodon", "bluesky"] as const;

/** Which normalized operations each connector implements. */
const SUPPORTED_OPERATIONS: Record<string, SocialOperation[]> = {
  // X media.upload requires OAuth 1.0a creds; it is exposed but throws
  // ConnectorOperationNotSupported at call time if those creds are absent.
  x: ["account.me", "post.create", "post.delete", "media.upload", "mentions.list", "analytics.post"],
  mastodon: ["account.me", "post.create", "post.delete", "media.upload", "mentions.list", "analytics.post"],
  // Bluesky (AT Protocol) has no first-class post analytics endpoint with
  // per-post metrics guaranteed; we expose aggregate counts from getPosts.
  bluesky: ["account.me", "post.create", "post.delete", "media.upload", "mentions.list", "analytics.post"],
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
