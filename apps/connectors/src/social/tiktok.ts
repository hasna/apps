/**
 * TikTok adapter for the stateless social SDK.
 *
 * The connectors/tiktok transport targets the Marketing/Ads API, not content
 * publishing, so we implement a minimal raw-fetch transport here against the
 * TikTok Content Posting API + Display API. Bundle-safe (fetch + Buffer only).
 *
 * TikTok is video-only:
 *   account.me   GET  /v2/user/info/
 *   media.upload POST /v2/post/publish/inbox/video/init/  (FILE_UPLOAD) + PUT bytes
 *   post.create  POST /v2/post/publish/video/init/        (requires a video mediaId)
 *
 * Without a video media id, post.create throws ConnectorOperationNotSupported.
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

export interface TikTokCredentials {
  accessToken: string;
  openId?: string;
}

/** TikTok `post.create` extras. */
export interface TikTokPostExtras {
  /** PUBLIC_TO_EVERYONE (default), MUTUAL_FOLLOW_FRIENDS, SELF_ONLY. */
  privacyLevel?: string;
}

const BASE = "https://open.tiktokapis.com";

export class TikTokAdapter implements SocialAdapter {
  private readonly accessToken: string;
  private readonly fetchImpl: FetchLike;

  constructor(creds: TikTokCredentials, fetchImpl?: FetchLike) {
    if (!creds || !creds.accessToken) {
      throw new Error("tiktok credentials require `accessToken`");
    }
    this.accessToken = creds.accessToken;
    this.fetchImpl = resolveFetch(fetchImpl);
  }

  static fromCredentials(creds: TikTokCredentials, fetchImpl?: FetchLike): TikTokAdapter {
    return new TikTokAdapter(creds, fetchImpl);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}`, ...(extra ?? {}) };
  }

  async accountMe(): Promise<AccountMeResult> {
    const res = await jsonRequest<{
      data?: { user?: { open_id?: string; union_id?: string; display_name?: string; profile_deep_link?: string } };
    }>(this.fetchImpl, `${BASE}/v2/user/info/`, {
      headers: this.headers(),
      query: { fields: "open_id,union_id,display_name,profile_deep_link" },
      errorLabel: "TikTok",
    });
    const user = res.data?.user ?? {};
    return {
      id: user.open_id ?? user.union_id ?? "",
      username: user.display_name,
      displayName: user.display_name,
      url: user.profile_deep_link,
    };
  }

  async postCreate(input: PostCreateInput & TikTokPostExtras): Promise<PostCreateResult> {
    const videoId = input.mediaIds?.[0];
    if (!videoId) {
      throw new ConnectorOperationNotSupported(
        "tiktok",
        "post.create (TikTok is video-only: provide a video media id in `mediaIds` via media.upload)",
      );
    }
    const body = {
      post_info: {
        title: input.text ?? "",
        privacy_level: input.privacyLevel ?? "PUBLIC_TO_EVERYONE",
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_id: videoId,
      },
    };
    const res = await jsonRequest<{ data?: { publish_id?: string }; error?: { code?: string } }>(
      this.fetchImpl,
      `${BASE}/v2/post/publish/video/init/`,
      { method: "POST", headers: this.headers({ "Content-Type": "application/json" }), body, errorLabel: "TikTok" },
    );
    return { id: res.data?.publish_id ?? videoId };
  }

  async postDelete(_input: PostDeleteInput): Promise<PostDeleteResult> {
    throw new ConnectorOperationNotSupported(
      "tiktok",
      "post.delete (the Content Posting API does not expose post deletion)",
    );
  }

  async mediaUpload(input: MediaUploadInput): Promise<MediaUploadResult> {
    const buffer = decodeBase64(input.dataBase64);
    const size = buffer.byteLength;
    // 1) init the upload, get an upload_url + publish_id.
    const init = await jsonRequest<{
      data?: { upload_url?: string; publish_id?: string };
    }>(this.fetchImpl, `${BASE}/v2/post/publish/inbox/video/init/`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: {
        source_info: {
          source: "FILE_UPLOAD",
          video_size: size,
          chunk_size: size,
          total_chunk_count: 1,
        },
      },
      errorLabel: "TikTok",
    });
    const uploadUrl = init.data?.upload_url;
    const publishId = init.data?.publish_id;
    if (!uploadUrl || !publishId) {
      throw new Error("TikTok media.upload: init did not return an upload_url/publish_id");
    }
    // 2) PUT the bytes to the returned upload URL.
    const bytes = Uint8Array.from(buffer);
    const put = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": input.mimeType,
        "Content-Range": `bytes 0-${size - 1}/${size}`,
      },
      body: bytes,
    });
    if (!put.ok) {
      throw new Error(`TikTok ${put.status}: video upload failed`);
    }
    return { mediaId: publishId };
  }

  async mentionsList(_input: MentionsListInput = {}): Promise<MentionsListResult> {
    throw new ConnectorOperationNotSupported(
      "tiktok",
      "mentions.list (no mentions endpoint in the Content Posting / Display API)",
    );
  }

  async analyticsPost(_input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    throw new ConnectorOperationNotSupported(
      "tiktok",
      "analytics.post (per-post metrics require the Research/Business API, not available here)",
    );
  }
}
