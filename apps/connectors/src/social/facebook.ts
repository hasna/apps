/**
 * Facebook (Pages) adapter for the stateless social SDK.
 *
 * Minimal raw-fetch transport against the Meta Graph API (graph.facebook.com)
 * with a Page access token. Bundle-safe (fetch + Buffer only).
 *
 *   account.me     GET    /{pageId}?fields=id,name,link
 *   post.create    POST   /{pageId}/feed              (message=text, link?)
 *   post.delete    DELETE /{id}
 *   media.upload   POST   /{pageId}/photos            (published=false → unattached photo)
 *   analytics.post GET    /{id}?fields=likes.summary(true),comments.summary(true),shares
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

export interface FacebookCredentials {
  /** Page access token. */
  accessToken: string;
  /** Target Facebook Page id. */
  pageId: string;
  /** Override the Graph API base (e.g. a pinned version host). */
  baseUrl?: string;
}

/** Facebook `post.create` extras. */
export interface FacebookPostExtras {
  /** Optional link URL attached to the feed post. */
  link?: string;
}

const DEFAULT_BASE = "https://graph.facebook.com/v19.0";

export class FacebookAdapter implements SocialAdapter {
  private readonly accessToken: string;
  private readonly pageId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(creds: FacebookCredentials, fetchImpl?: FetchLike) {
    if (!creds || !creds.accessToken) {
      throw new Error("facebook credentials require `accessToken`");
    }
    if (!creds.pageId) {
      throw new Error("facebook credentials require `pageId`");
    }
    this.accessToken = creds.accessToken;
    this.pageId = creds.pageId;
    this.baseUrl = (creds.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.fetchImpl = resolveFetch(fetchImpl);
  }

  static fromCredentials(creds: FacebookCredentials, fetchImpl?: FetchLike): FacebookAdapter {
    return new FacebookAdapter(creds, fetchImpl);
  }

  private auth(): Record<string, string> {
    return { access_token: this.accessToken };
  }

  async accountMe(): Promise<AccountMeResult> {
    const me = await jsonRequest<{ id: string; name?: string; link?: string }>(
      this.fetchImpl,
      `${this.baseUrl}/${encodeURIComponent(this.pageId)}`,
      { query: { fields: "id,name,link", ...this.auth() }, errorLabel: "Facebook" },
    );
    return {
      id: me.id,
      displayName: me.name,
      url: me.link,
    };
  }

  async postCreate(input: PostCreateInput & FacebookPostExtras): Promise<PostCreateResult> {
    const body: Record<string, string> = { access_token: this.accessToken };
    if (input.text) body.message = input.text;
    if (input.link) body.link = input.link;
    if (input.mediaIds && input.mediaIds.length > 0) {
      // Attach already-uploaded unpublished photos to the feed post.
      body.attached_media = JSON.stringify(input.mediaIds.map((id) => ({ media_fbid: id })));
    }
    const res = await jsonRequest<{ id: string; post_id?: string }>(
      this.fetchImpl,
      `${this.baseUrl}/${encodeURIComponent(this.pageId)}/feed`,
      { method: "POST", body: new URLSearchParams(body).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" }, errorLabel: "Facebook" },
    );
    const id = res.post_id ?? res.id;
    return { id, url: `https://facebook.com/${id}` };
  }

  async postDelete(input: PostDeleteInput): Promise<PostDeleteResult> {
    await jsonRequest<{ success?: boolean }>(
      this.fetchImpl,
      `${this.baseUrl}/${encodeURIComponent(input.id)}`,
      { method: "DELETE", query: this.auth(), errorLabel: "Facebook" },
    );
    return { id: input.id, deleted: true };
  }

  async mediaUpload(input: MediaUploadInput): Promise<MediaUploadResult> {
    const buffer = decodeBase64(input.dataBase64);
    const bytes = Uint8Array.from(buffer);
    const form = new FormData();
    form.append("access_token", this.accessToken);
    form.append("published", "false");
    form.append("source", new Blob([bytes], { type: input.mimeType }), "upload");
    const res = await jsonRequest<{ id: string }>(
      this.fetchImpl,
      `${this.baseUrl}/${encodeURIComponent(this.pageId)}/photos`,
      { method: "POST", body: form, errorLabel: "Facebook" },
    );
    return { mediaId: res.id };
  }

  async mentionsList(_input: MentionsListInput = {}): Promise<MentionsListResult> {
    throw new ConnectorOperationNotSupported(
      "facebook",
      "mentions.list (Page mentions require the deprecated/limited tagged edge; not modeled)",
    );
  }

  async analyticsPost(input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    const res = await jsonRequest<{
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
    }>(this.fetchImpl, `${this.baseUrl}/${encodeURIComponent(input.id)}`, {
      query: { fields: "likes.summary(true),comments.summary(true),shares", ...this.auth() },
      errorLabel: "Facebook",
    });
    const metrics: Record<string, number> = {
      likes: res.likes?.summary?.total_count ?? 0,
      comments: res.comments?.summary?.total_count ?? 0,
      shares: res.shares?.count ?? 0,
    };
    return { metrics };
  }
}
