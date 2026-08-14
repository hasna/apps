/**
 * Pinterest adapter for the stateless social SDK.
 *
 * Minimal raw-fetch transport against the Pinterest API v5 with a Bearer access
 * token. Bundle-safe (fetch + Buffer only).
 *
 *   account.me     GET    /v5/user_account
 *   post.create    POST   /v5/pins                 (boardId REQUIRED; image via mediaId or imageUrl)
 *   post.delete    DELETE /v5/pins/{id}
 *   media.upload   POST   /v5/media (register) + PUT to the AWS form url
 *   analytics.post GET    /v5/pins/{id}/analytics
 */
import { ConnectorOperationNotSupported } from "./errors";
import { decodeBase64 } from "./util";
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

export interface PinterestCredentials {
  accessToken: string;
  boardId?: string;
}

/** Pinterest `post.create` extras. A pin needs an image: a mediaId or an imageUrl. */
export interface PinterestPostExtras {
  /** Board to pin to (REQUIRED unless provided via credentials). */
  boardId?: string;
  /** Public image URL (used when no uploaded mediaId is supplied). */
  imageUrl?: string;
  /** Destination link for the pin. */
  link?: string;
  /** Pin title (defaults to undefined; `text` becomes the description). */
  title?: string;
}

const BASE = "https://api.pinterest.com";

export class PinterestAdapter implements SocialAdapter {
  private readonly accessToken: string;
  private readonly defaultBoardId?: string;
  private readonly fetchImpl: FetchLike;

  constructor(creds: PinterestCredentials, fetchImpl?: FetchLike) {
    if (!creds || !creds.accessToken) {
      throw new Error("pinterest credentials require `accessToken`");
    }
    this.accessToken = creds.accessToken;
    this.defaultBoardId = creds.boardId;
    this.fetchImpl = resolveFetch(fetchImpl);
  }

  static fromCredentials(creds: PinterestCredentials, fetchImpl?: FetchLike): PinterestAdapter {
    return new PinterestAdapter(creds, fetchImpl);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}`, ...(extra ?? {}) };
  }

  async accountMe(): Promise<AccountMeResult> {
    const acct = await jsonRequest<{ username?: string; account_type?: string; profile_image?: string }>(
      this.fetchImpl,
      `${BASE}/v5/user_account`,
      { headers: this.headers(), errorLabel: "Pinterest" },
    );
    return {
      id: acct.username ?? "",
      username: acct.username,
      displayName: acct.username,
      url: acct.username ? `https://www.pinterest.com/${acct.username}/` : undefined,
    };
  }

  async postCreate(input: PostCreateInput & PinterestPostExtras): Promise<PostCreateResult> {
    const boardId = input.boardId ?? this.defaultBoardId;
    if (!boardId) {
      throw new Error("pinterest post.create requires `boardId` (in input or credentials)");
    }
    const mediaId = input.mediaIds?.[0];
    let mediaSource: Record<string, unknown>;
    if (mediaId) {
      mediaSource = { source_type: "image_upload", media_id: mediaId };
    } else if (input.imageUrl) {
      mediaSource = { source_type: "image_url", url: input.imageUrl };
    } else {
      throw new Error("pinterest post.create requires an image: provide a `mediaIds` entry or `imageUrl`");
    }
    const body: Record<string, unknown> = {
      board_id: boardId,
      description: input.text,
      media_source: mediaSource,
    };
    if (input.title) body.title = input.title;
    if (input.link) body.link = input.link;
    const pin = await jsonRequest<{ id: string }>(this.fetchImpl, `${BASE}/v5/pins`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body,
      errorLabel: "Pinterest",
    });
    return { id: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/` };
  }

  async postDelete(input: PostDeleteInput): Promise<PostDeleteResult> {
    await jsonRequest(this.fetchImpl, `${BASE}/v5/pins/${encodeURIComponent(input.id)}`, {
      method: "DELETE",
      headers: this.headers(),
      errorLabel: "Pinterest",
    });
    return { id: input.id, deleted: true };
  }

  async mediaUpload(input: MediaUploadInput): Promise<MediaUploadResult> {
    // 1) Register the media upload; Pinterest returns an S3 form post target.
    const register = await jsonRequest<{
      media_id: string;
      upload_url: string;
      upload_parameters?: Record<string, string>;
    }>(this.fetchImpl, `${BASE}/v5/media`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: { media_type: "image" },
      errorLabel: "Pinterest",
    });
    // 2) POST the file to the returned S3 form (multipart with provided params).
    const buffer = decodeBase64(input.dataBase64);
    const bytes = Uint8Array.from(buffer);
    const form = new FormData();
    for (const [k, v] of Object.entries(register.upload_parameters ?? {})) {
      form.append(k, v);
    }
    form.append("file", new Blob([bytes], { type: input.mimeType }));
    const put = await this.fetchImpl(register.upload_url, { method: "POST", body: form });
    if (!put.ok) {
      throw new Error(`Pinterest ${put.status}: media upload failed`);
    }
    return { mediaId: register.media_id };
  }

  async mentionsList(_input: MentionsListInput = {}): Promise<MentionsListResult> {
    throw new ConnectorOperationNotSupported(
      "pinterest",
      "mentions.list (no mentions endpoint in the Pinterest API)",
    );
  }

  async analyticsPost(input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    const res = await jsonRequest<{ all?: Record<string, { summary_metrics?: Record<string, number> }> }>(
      this.fetchImpl,
      `${BASE}/v5/pins/${encodeURIComponent(input.id)}/analytics`,
      {
        headers: this.headers(),
        query: { metric_types: "IMPRESSION,PIN_CLICK,SAVE,OUTBOUND_CLICK" },
        errorLabel: "Pinterest",
      },
    );
    const summary = res.all?.["DAILY"]?.summary_metrics ?? res.all?.["TOTAL"]?.summary_metrics ?? {};
    const metrics: Record<string, number> = {};
    for (const [k, v] of Object.entries(summary)) {
      metrics[k] = typeof v === "number" ? v : Number(v) || 0;
    }
    return { metrics };
  }
}
