/**
 * Reddit adapter for the stateless social SDK.
 *
 * Minimal raw-fetch transport against the OAuth Reddit API (oauth.reddit.com)
 * with a Bearer access token. Bundle-safe (fetch only).
 *
 * Endpoints:
 *   account.me    GET  /api/v1/me
 *   post.create   POST /api/submit          (title + subreddit REQUIRED)
 *   post.delete   POST /api/del
 *   mentions.list GET  /message/inbox
 *   analytics.post GET /api/info?id=t3_<id>
 */
import { ConnectorOperationNotSupported } from "./errors";
import { jsonRequest, resolveFetch, type FetchLike } from "./http";
import type {
  AccountMeResult,
  AnalyticsPostInput,
  AnalyticsPostResult,
  MediaUploadInput,
  MediaUploadResult,
  MentionsListInput,
  MentionsListResult,
  PostCreateInput,
  PostCreateResult,
  PostDeleteInput,
  PostDeleteResult,
  SocialAdapter,
} from "./types";

export interface RedditCredentials {
  accessToken: string;
  userAgent?: string;
}

/** Reddit `post.create` extras (title + subreddit are required). */
export interface RedditPostExtras {
  title: string;
  subreddit: string;
  /** "self" (text post, default) or "link" (url post). */
  kind?: "self" | "link";
  /** URL for a `kind: "link"` post. */
  url?: string;
}

const BASE = "https://oauth.reddit.com";

/** Reddit fullname prefix for a link/submission. */
function fullname(id: string): string {
  return id.startsWith("t3_") ? id : `t3_${id}`;
}

export class RedditAdapter implements SocialAdapter {
  private readonly accessToken: string;
  private readonly userAgent: string;
  private readonly fetchImpl: FetchLike;

  constructor(creds: RedditCredentials, fetchImpl?: FetchLike) {
    if (!creds || !creds.accessToken) {
      throw new Error("reddit credentials require `accessToken`");
    }
    this.accessToken = creds.accessToken;
    this.userAgent = creds.userAgent ?? "hasna-connectors/social";
    this.fetchImpl = resolveFetch(fetchImpl);
  }

  static fromCredentials(creds: RedditCredentials, fetchImpl?: FetchLike): RedditAdapter {
    return new RedditAdapter(creds, fetchImpl);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "User-Agent": this.userAgent,
      ...(extra ?? {}),
    };
  }

  /** Reddit form endpoints want application/x-www-form-urlencoded. */
  private form(params: Record<string, string | undefined>): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.append(k, v);
    }
    return qs.toString();
  }

  async accountMe(): Promise<AccountMeResult> {
    const me = await jsonRequest<{ id: string; name: string; subreddit?: { url?: string } }>(
      this.fetchImpl,
      `${BASE}/api/v1/me`,
      { headers: this.headers(), errorLabel: "Reddit" },
    );
    return {
      id: me.id,
      username: me.name,
      displayName: me.name,
      url: `https://www.reddit.com/user/${me.name}`,
    };
  }

  async postCreate(input: PostCreateInput & Partial<RedditPostExtras>): Promise<PostCreateResult> {
    if (!input.title) {
      throw new Error("reddit post.create requires `title`");
    }
    if (!input.subreddit) {
      throw new Error("reddit post.create requires `subreddit`");
    }
    const kind = input.kind ?? "self";
    if (kind === "link" && !input.url) {
      throw new Error('reddit post.create with kind "link" requires `url`');
    }
    const body = this.form({
      sr: input.subreddit,
      title: input.title,
      kind,
      text: kind === "self" ? input.text : undefined,
      url: kind === "link" ? input.url : undefined,
      api_type: "json",
    });
    const res = await jsonRequest<{
      json: { errors?: unknown[]; data?: { id?: string; name?: string; url?: string } };
    }>(this.fetchImpl, `${BASE}/api/submit`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body,
      errorLabel: "Reddit",
    });
    const errors = res.json?.errors ?? [];
    if (errors.length > 0) {
      throw new Error(`Reddit submit failed: ${JSON.stringify(errors)}`);
    }
    const data = res.json?.data ?? {};
    return { id: data.id ?? data.name ?? "", url: data.url };
  }

  async postDelete(input: PostDeleteInput): Promise<PostDeleteResult> {
    await jsonRequest(this.fetchImpl, `${BASE}/api/del`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: this.form({ id: fullname(input.id) }),
      errorLabel: "Reddit",
    });
    return { id: input.id, deleted: true };
  }

  async mediaUpload(_input: MediaUploadInput): Promise<MediaUploadResult> {
    throw new ConnectorOperationNotSupported(
      "reddit",
      "media.upload (image uploads require the media asset-lease flow; not supported by this SDK)",
    );
  }

  async mentionsList(input: MentionsListInput = {}): Promise<MentionsListResult> {
    const res = await jsonRequest<{
      data: {
        children: Array<{
          data: {
            id: string;
            name?: string;
            body?: string;
            author?: string;
            author_fullname?: string;
            created_utc?: number;
            type?: string;
          };
        }>;
      };
    }>(this.fetchImpl, `${BASE}/message/inbox`, {
      headers: this.headers(),
      query: { limit: input.limit, after: input.sinceId },
      errorLabel: "Reddit",
    });
    const items = (res.data?.children ?? []).map((c) => ({
      id: c.data.name ?? c.data.id,
      text: c.data.body ?? "",
      authorId: c.data.author_fullname,
      authorHandle: c.data.author,
      createdAt: c.data.created_utc ? new Date(c.data.created_utc * 1000).toISOString() : undefined,
    }));
    return { items };
  }

  async analyticsPost(input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    const res = await jsonRequest<{
      data: {
        children: Array<{
          data: { ups?: number; downs?: number; score?: number; num_comments?: number; upvote_ratio?: number };
        }>;
      };
    }>(this.fetchImpl, `${BASE}/api/info`, {
      headers: this.headers(),
      query: { id: fullname(input.id) },
      errorLabel: "Reddit",
    });
    const post = res.data?.children?.[0]?.data;
    if (!post) {
      throw new ConnectorOperationNotSupported("reddit", `analytics.post (post not found: ${input.id})`);
    }
    return {
      metrics: {
        ups: post.ups ?? 0,
        downs: post.downs ?? 0,
        score: post.score ?? 0,
        numComments: post.num_comments ?? 0,
        upvoteRatio: post.upvote_ratio ?? 0,
      },
    };
  }
}
