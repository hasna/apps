/**
 * Threads (Meta) adapter for the stateless social SDK.
 *
 * Minimal raw-fetch transport against the Threads API (graph.threads.net) with a
 * user access token. Bundle-safe (fetch + Buffer only).
 *
 * Threads publishing is a two-step container flow (supports text-only, and reply
 * chaining via reply_to_id):
 *   account.me     GET  /{userId}?fields=id,username
 *   post.create    POST /{userId}/threads (media_type=TEXT, text, reply_to_id?) +
 *                  POST /{userId}/threads_publish (creation_id)
 *   post.delete    DELETE /{id}
 *   media.upload   POST /{userId}/threads (IMAGE/VIDEO container) → creation_id
 *   analytics.post GET  /{id}/insights
 *   mentions.list  GET  /{userId}/mentions (if available) else not supported
 */
import { ConnectorOperationNotSupported } from "./errors";
import { jsonRequest, resolveFetch, type FetchLike } from "./http";
import type {
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
  SocialAdapter,
} from "./types";

export interface ThreadsCredentials {
  /** Threads user access token. */
  accessToken: string;
  /** Threads user id. */
  userId: string;
  baseUrl?: string;
}

/** Threads `post.create` extras. */
export interface ThreadsPostExtras {
  /** Id of an existing thread to reply to (enables reply chaining). */
  replyToId?: string;
}

/** Threads `media.upload` extras. */
export interface ThreadsMediaExtras {
  /** Public URL of the image to build an IMAGE container from. */
  sourceUrl?: string;
  /** Public URL of the video to build a VIDEO container from. */
  videoUrl?: string;
  /** Caption / text for the media container. */
  text?: string;
}

const DEFAULT_BASE = "https://graph.threads.net/v1.0";

export class ThreadsAdapter implements SocialAdapter {
  private readonly accessToken: string;
  private readonly userId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private cachedUsername?: string;

  constructor(creds: ThreadsCredentials, fetchImpl?: FetchLike) {
    if (!creds || !creds.accessToken) {
      throw new Error("threads credentials require `accessToken`");
    }
    if (!creds.userId) {
      throw new Error("threads credentials require `userId`");
    }
    this.accessToken = creds.accessToken;
    this.userId = creds.userId;
    this.baseUrl = (creds.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.fetchImpl = resolveFetch(fetchImpl);
  }

  static fromCredentials(creds: ThreadsCredentials, fetchImpl?: FetchLike): ThreadsAdapter {
    return new ThreadsAdapter(creds, fetchImpl);
  }

  private form(fields: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    params.append("access_token", this.accessToken);
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== "") params.append(k, v);
    }
    return params.toString();
  }

  private postForm<T>(path: string, fields: Record<string, string | undefined>): Promise<T> {
    return jsonRequest<T>(this.fetchImpl, `${this.baseUrl}/${path}`, {
      method: "POST",
      body: this.form(fields),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      errorLabel: "Threads",
    });
  }

  async accountMe(): Promise<AccountMeResult> {
    const me = await jsonRequest<{ id: string; username?: string }>(
      this.fetchImpl,
      `${this.baseUrl}/${encodeURIComponent(this.userId)}`,
      { query: { fields: "id,username", access_token: this.accessToken }, errorLabel: "Threads" },
    );
    this.cachedUsername = me.username;
    return {
      id: me.id,
      username: me.username,
      url: me.username ? `https://www.threads.net/@${me.username}` : undefined,
    };
  }

  async postCreate(input: PostCreateInput & ThreadsPostExtras): Promise<PostCreateResult> {
    let creationId = input.mediaIds?.[0];
    if (!creationId) {
      // Text container (with optional reply chaining).
      const container = await this.postForm<{ id: string }>(
        `${encodeURIComponent(this.userId)}/threads`,
        { media_type: "TEXT", text: input.text, reply_to_id: input.replyToId },
      );
      creationId = container.id;
    }
    const published = await this.postForm<{ id: string }>(
      `${encodeURIComponent(this.userId)}/threads_publish`,
      { creation_id: creationId },
    );
    const url = this.cachedUsername
      ? `https://www.threads.net/@${this.cachedUsername}/post/${published.id}`
      : undefined;
    return { id: published.id, url };
  }

  async postDelete(input: PostDeleteInput): Promise<PostDeleteResult> {
    await jsonRequest(this.fetchImpl, `${this.baseUrl}/${encodeURIComponent(input.id)}`, {
      method: "DELETE",
      query: { access_token: this.accessToken },
      errorLabel: "Threads",
    });
    return { id: input.id, deleted: true };
  }

  async mediaUpload(input: MediaUploadInput & ThreadsMediaExtras): Promise<MediaUploadResult> {
    let fields: Record<string, string | undefined>;
    if (input.sourceUrl) {
      fields = { media_type: "IMAGE", image_url: input.sourceUrl, text: input.text };
    } else if (input.videoUrl) {
      fields = { media_type: "VIDEO", video_url: input.videoUrl, text: input.text };
    } else {
      throw new ConnectorOperationNotSupported(
        "threads",
        "media.upload requires a public `sourceUrl` (image) or `videoUrl` (video)",
      );
    }
    const container = await this.postForm<{ id: string }>(
      `${encodeURIComponent(this.userId)}/threads`,
      fields,
    );
    return { mediaId: container.id };
  }

  async mentionsList(input: MentionsListInput = {}): Promise<MentionsListResult> {
    let res: { data?: Array<{ id: string; text?: string; username?: string; timestamp?: string }> };
    try {
      res = await jsonRequest(this.fetchImpl, `${this.baseUrl}/${encodeURIComponent(this.userId)}/mentions`, {
        query: {
          fields: "id,text,username,timestamp",
          limit: input.limit !== undefined ? String(input.limit) : undefined,
          access_token: this.accessToken,
        },
        errorLabel: "Threads",
      });
    } catch {
      throw new ConnectorOperationNotSupported(
        "threads",
        "mentions.list (the Threads mentions edge is not available for this account)",
      );
    }
    const items: MentionItem[] = (res.data ?? []).map((m) => ({
      id: m.id,
      text: m.text ?? "",
      authorHandle: m.username,
      createdAt: m.timestamp,
    }));
    return { items };
  }

  async analyticsPost(input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    const res = await jsonRequest<{ data?: Array<{ name: string; values?: Array<{ value: number }> }> }>(
      this.fetchImpl,
      `${this.baseUrl}/${encodeURIComponent(input.id)}/insights`,
      {
        query: { metric: "views,likes,replies,reposts,quotes", access_token: this.accessToken },
        errorLabel: "Threads",
      },
    );
    const metrics: Record<string, number> = {};
    for (const m of res.data ?? []) {
      const v = m.values?.[0]?.value;
      if (typeof v === "number") metrics[m.name] = v;
    }
    return { metrics };
  }
}
