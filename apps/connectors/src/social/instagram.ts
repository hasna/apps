/**
 * Instagram (Graph API) adapter for the stateless social SDK.
 *
 * Minimal raw-fetch transport against the Instagram Graph API
 * (graph.facebook.com) with a long-lived user access token. Bundle-safe
 * (fetch + Buffer only).
 *
 * Instagram publishing is a two-step container flow and ALWAYS requires media:
 *   media.upload   POST /{igUserId}/media        → creation_id (container)
 *   post.create    POST /{igUserId}/media (if needed) + POST /{igUserId}/media_publish
 *   account.me     GET  /{igUserId}?fields=id,username
 *   analytics.post GET  /{id}/insights
 *
 * post.delete and mentions.list are not available via the IG Graph API.
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

export interface InstagramCredentials {
  /** Long-lived user access token with instagram_content_publish. */
  accessToken: string;
  /** IG user id (the IG-Business account id). */
  igUserId: string;
  baseUrl?: string;
}

/** Instagram `media.upload` extras (IG uploads from a public URL, not bytes). */
export interface InstagramMediaExtras {
  /** Public URL of the image to build a container from. */
  sourceUrl?: string;
  /** Caption for the resulting container. */
  caption?: string;
}

/** Instagram `post.create` extras. */
export interface InstagramPostExtras {
  /** Public image URL to publish (when no prebuilt container `mediaIds` is given). */
  imageUrl?: string;
}

const DEFAULT_BASE = "https://graph.facebook.com/v19.0";

export class InstagramAdapter implements SocialAdapter {
  private readonly accessToken: string;
  private readonly igUserId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(creds: InstagramCredentials, fetchImpl?: FetchLike) {
    if (!creds || !creds.accessToken) {
      throw new Error("instagram credentials require `accessToken`");
    }
    if (!creds.igUserId) {
      throw new Error("instagram credentials require `igUserId`");
    }
    this.accessToken = creds.accessToken;
    this.igUserId = creds.igUserId;
    this.baseUrl = (creds.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.fetchImpl = resolveFetch(fetchImpl);
  }

  static fromCredentials(creds: InstagramCredentials, fetchImpl?: FetchLike): InstagramAdapter {
    return new InstagramAdapter(creds, fetchImpl);
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
      errorLabel: "Instagram",
    });
  }

  /** Create a media container from a public image URL; returns its creation id. */
  private async createContainer(imageUrl: string, caption?: string): Promise<string> {
    const res = await this.postForm<{ id: string }>(`${encodeURIComponent(this.igUserId)}/media`, {
      image_url: imageUrl,
      caption,
    });
    return res.id;
  }

  async accountMe(): Promise<AccountMeResult> {
    const me = await jsonRequest<{ id: string; username?: string }>(
      this.fetchImpl,
      `${this.baseUrl}/${encodeURIComponent(this.igUserId)}`,
      { query: { fields: "id,username", access_token: this.accessToken }, errorLabel: "Instagram" },
    );
    return {
      id: me.id,
      username: me.username,
      url: me.username ? `https://www.instagram.com/${me.username}/` : undefined,
    };
  }

  async postCreate(input: PostCreateInput & InstagramPostExtras): Promise<PostCreateResult> {
    let creationId = input.mediaIds?.[0];
    if (!creationId) {
      if (!input.imageUrl) {
        throw new ConnectorOperationNotSupported(
          "instagram",
          "post.create requires an image or video (provide `imageUrl` or a `mediaIds` container)",
        );
      }
      creationId = await this.createContainer(input.imageUrl, input.text);
    }
    const published = await this.postForm<{ id: string }>(
      `${encodeURIComponent(this.igUserId)}/media_publish`,
      { creation_id: creationId },
    );
    return {
      id: published.id,
      url: `https://www.instagram.com/p/${published.id}/`,
    };
  }

  async postDelete(_input: PostDeleteInput): Promise<PostDeleteResult> {
    throw new ConnectorOperationNotSupported(
      "instagram",
      "post.delete (the Instagram Graph API cannot delete published media)",
    );
  }

  async mediaUpload(input: MediaUploadInput & InstagramMediaExtras): Promise<MediaUploadResult> {
    if (!input.sourceUrl) {
      throw new ConnectorOperationNotSupported(
        "instagram",
        "media.upload requires a public `sourceUrl` (IG builds containers from a URL, not raw bytes)",
      );
    }
    const creationId = await this.createContainer(input.sourceUrl, input.caption);
    return { mediaId: creationId };
  }

  async mentionsList(_input: MentionsListInput = {}): Promise<MentionsListResult> {
    throw new ConnectorOperationNotSupported(
      "instagram",
      "mentions.list (tagged/mentioned media require the dedicated mentions edge; not modeled)",
    );
  }

  async analyticsPost(input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    const res = await jsonRequest<{ data?: Array<{ name: string; values?: Array<{ value: number }> }> }>(
      this.fetchImpl,
      `${this.baseUrl}/${encodeURIComponent(input.id)}/insights`,
      {
        query: { metric: "impressions,reach,likes,comments,saved", access_token: this.accessToken },
        errorLabel: "Instagram",
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
