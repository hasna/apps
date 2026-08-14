/**
 * YouTube adapter for the stateless social SDK.
 *
 * Minimal raw-fetch transport against the YouTube Data API v3 with a Bearer
 * access token. Bundle-safe (fetch + Buffer only). YouTube is video-only.
 *
 *   account.me   GET    /youtube/v3/channels?part=snippet&mine=true
 *   media.upload POST    (resumable) /upload/youtube/v3/videos -> PUT bytes -> videoId
 *   post.create  requires a video media id; sets title/description via videos.update
 *   post.delete  DELETE  /youtube/v3/videos?id=<id>
 *   analytics.post GET   /youtube/v3/videos?part=statistics&id=<id>
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

export interface YouTubeCredentials {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
}

/** YouTube `post.create` extras. */
export interface YouTubePostExtras {
  title?: string;
  description?: string;
  privacyStatus?: "public" | "private" | "unlisted";
  /** Numeric category id (default "22" = People & Blogs). */
  categoryId?: string;
}

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";

export class YouTubeAdapter implements SocialAdapter {
  private readonly accessToken: string;
  private readonly fetchImpl: FetchLike;

  constructor(creds: YouTubeCredentials, fetchImpl?: FetchLike) {
    if (!creds || !creds.accessToken) {
      throw new Error("youtube credentials require `accessToken`");
    }
    this.accessToken = creds.accessToken;
    this.fetchImpl = resolveFetch(fetchImpl);
  }

  static fromCredentials(creds: YouTubeCredentials, fetchImpl?: FetchLike): YouTubeAdapter {
    return new YouTubeAdapter(creds, fetchImpl);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}`, ...(extra ?? {}) };
  }

  async accountMe(): Promise<AccountMeResult> {
    const res = await jsonRequest<{
      items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }>;
    }>(this.fetchImpl, `${API}/channels`, {
      headers: this.headers(),
      query: { part: "snippet", mine: "true" },
      errorLabel: "YouTube",
    });
    const channel = res.items?.[0];
    if (!channel) {
      throw new Error("YouTube account.me: no channel found for the authenticated user");
    }
    return {
      id: channel.id,
      username: channel.snippet?.customUrl ?? channel.snippet?.title,
      displayName: channel.snippet?.title,
      url: `https://www.youtube.com/channel/${channel.id}`,
    };
  }

  async postCreate(input: PostCreateInput & YouTubePostExtras): Promise<PostCreateResult> {
    const videoId = input.mediaIds?.[0];
    if (!videoId) {
      throw new ConnectorOperationNotSupported(
        "youtube",
        "post.create (YouTube is video-only: upload a video via media.upload and pass its id in `mediaIds`)",
      );
    }
    // The video is already inserted by media.upload; update its title/description.
    const title = input.title ?? input.text ?? "";
    const description = input.description ?? input.text ?? "";
    await jsonRequest(this.fetchImpl, `${API}/videos`, {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/json" }),
      query: { part: "snippet" },
      body: {
        id: videoId,
        snippet: { title, description, categoryId: input.categoryId ?? "22" },
      },
      errorLabel: "YouTube",
    });
    return { id: videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
  }

  async postDelete(input: PostDeleteInput): Promise<PostDeleteResult> {
    await jsonRequest(this.fetchImpl, `${API}/videos`, {
      method: "DELETE",
      headers: this.headers(),
      query: { id: input.id },
      errorLabel: "YouTube",
    });
    return { id: input.id, deleted: true };
  }

  async mediaUpload(input: MediaUploadInput & YouTubePostExtras): Promise<MediaUploadResult> {
    const buffer = decodeBase64(input.dataBase64);
    const size = buffer.byteLength;
    // 1) Start a resumable upload session with the video metadata.
    const start = await this.fetchImpl(`${UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(size),
      }),
      body: JSON.stringify({
        snippet: { title: input.title ?? input.altText ?? "Untitled", description: input.description ?? "" },
        status: { privacyStatus: input.privacyStatus ?? "private" },
      }),
    });
    if (!start.ok) {
      throw new Error(`YouTube ${start.status}: resumable upload init failed`);
    }
    const location = start.headers?.get("location");
    if (!location) {
      throw new Error("YouTube media.upload: resumable session did not return a Location header");
    }
    // 2) PUT the bytes to the session URL.
    const bytes = Uint8Array.from(buffer);
    const put = await this.fetchImpl(location, {
      method: "PUT",
      headers: { "Content-Type": input.mimeType, "Content-Length": String(size) },
      body: bytes,
    });
    const text = await put.text();
    const data = text ? JSON.parse(text) : {};
    if (!put.ok) {
      throw new Error(`YouTube ${put.status}: video upload failed`);
    }
    return { mediaId: String(data.id) };
  }

  async mentionsList(_input: MentionsListInput = {}): Promise<MentionsListResult> {
    throw new ConnectorOperationNotSupported(
      "youtube",
      "mentions.list (no mentions endpoint in the YouTube Data API)",
    );
  }

  async analyticsPost(input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    const res = await jsonRequest<{
      items?: Array<{
        statistics?: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
          favoriteCount?: string;
        };
      }>;
    }>(this.fetchImpl, `${API}/videos`, {
      headers: this.headers(),
      query: { part: "statistics", id: input.id },
      errorLabel: "YouTube",
    });
    const stats = res.items?.[0]?.statistics;
    if (!stats) {
      throw new ConnectorOperationNotSupported("youtube", `analytics.post (video not found: ${input.id})`);
    }
    return {
      metrics: {
        viewCount: Number(stats.viewCount ?? 0),
        likeCount: Number(stats.likeCount ?? 0),
        commentCount: Number(stats.commentCount ?? 0),
        favoriteCount: Number(stats.favoriteCount ?? 0),
      },
    };
  }
}
