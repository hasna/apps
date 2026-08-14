/**
 * X (Twitter) adapter for the stateless social SDK.
 *
 * Reuses the existing transport in connectors/x/src/api (X / XClient / TweetsApi /
 * UsersApi / MediaApi). Credentials are passed in per call — nothing is read from
 * disk or the environment. Bundle-safe: the X api modules only use raw fetch +
 * Buffer (the one fs-using path, MediaApi.uploadFile, lazy-imports node:fs and is
 * never called here — we use uploadBuffer).
 */
import { X } from "../../connectors/x/src/api/index";
import { ConnectorOperationNotSupported } from "./errors";
import { decodeBase64 } from "./util";
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

/** Minimal structural type for the X transport so tests can inject a mock. */
export interface XTransport {
  tweets: {
    create(opts: { text: string; replyToTweetId?: string; mediaIds?: string[] }): Promise<{
      data: { id: string; text: string };
    }>;
    delete(id: string): Promise<{ data: { deleted: boolean } }>;
    get(id: string, options?: unknown): Promise<{ data: { id: string; public_metrics?: Record<string, number> } }>;
    getUserMentions(
      userId: string,
      options?: unknown,
    ): Promise<{
      data: Array<{ id: string; text: string; author_id?: string; created_at?: string }>;
      includes?: { users?: Array<{ id: string; username: string }> };
    }>;
  };
  users: {
    me(): Promise<{ data: { id: string; username: string; name?: string } }>;
  };
  media?: {
    uploadBuffer(
      data: Buffer,
      mimeType: string,
      options?: { altText?: string },
    ): Promise<{ media_id_string: string }>;
  };
}

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken?: string;
  refreshToken?: string;
  bearerToken?: string;
  oauth1AccessToken?: string;
  oauth1AccessTokenSecret?: string;
  clientId?: string;
  clientSecret?: string;
}

export class XAdapter implements SocialAdapter {
  private readonly x: XTransport;
  /** Cached authenticated user (id + username) to build URLs / mentions. */
  private me?: { id: string; username: string; displayName?: string };

  constructor(x: XTransport) {
    this.x = x;
  }

  static fromCredentials(creds: XCredentials): XAdapter {
    if (!creds || !creds.apiKey || !creds.apiSecret) {
      throw new Error("x credentials require `apiKey` and `apiSecret`");
    }
    const x = new X({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      bearerToken: creds.bearerToken,
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      oauth1AccessToken: creds.oauth1AccessToken,
      oauth1AccessTokenSecret: creds.oauth1AccessTokenSecret,
    });
    return new XAdapter(x as unknown as XTransport);
  }

  private async resolveMe(): Promise<{ id: string; username: string; displayName?: string }> {
    if (this.me) return this.me;
    const res = await this.x.users.me();
    this.me = { id: res.data.id, username: res.data.username, displayName: res.data.name };
    return this.me;
  }

  async accountMe(): Promise<AccountMeResult> {
    const me = await this.resolveMe();
    return {
      id: me.id,
      username: me.username,
      displayName: me.displayName,
      url: `https://x.com/${me.username}`,
    };
  }

  async postCreate(input: PostCreateInput): Promise<PostCreateResult> {
    const res = await this.x.tweets.create({
      text: input.text,
      replyToTweetId: input.replyToId,
      mediaIds: input.mediaIds,
    });
    const id = res.data.id;
    const me = await this.resolveMe();
    return { id, url: `https://x.com/${me.username}/status/${id}` };
  }

  async postDelete(input: PostDeleteInput): Promise<PostDeleteResult> {
    const res = await this.x.tweets.delete(input.id);
    return { id: input.id, deleted: Boolean(res.data.deleted) };
  }

  async mediaUpload(input: MediaUploadInput): Promise<MediaUploadResult> {
    if (!this.x.media) {
      throw new ConnectorOperationNotSupported(
        "x",
        "media.upload (requires OAuth 1.0a credentials: oauth1AccessToken + oauth1AccessTokenSecret)",
      );
    }
    const buffer = decodeBase64(input.dataBase64);
    const res = await this.x.media.uploadBuffer(buffer, input.mimeType, {
      altText: input.altText,
    });
    return { mediaId: res.media_id_string };
  }

  async mentionsList(input: MentionsListInput = {}): Promise<MentionsListResult> {
    const me = await this.resolveMe();
    const res = await this.x.tweets.getUserMentions(me.id, {
      sinceId: input.sinceId,
      maxResults: input.limit,
    });
    const handleById = new Map<string, string>();
    for (const u of res.includes?.users ?? []) {
      handleById.set(u.id, u.username);
    }
    const items = (res.data ?? []).map((t) => ({
      id: t.id,
      text: t.text,
      authorId: t.author_id,
      authorHandle: t.author_id ? handleById.get(t.author_id) : undefined,
      createdAt: t.created_at,
    }));
    return { items };
  }

  async analyticsPost(input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    const res = await this.x.tweets.get(input.id, {
      tweetFields: ["public_metrics"],
    });
    const metrics = res.data.public_metrics ?? {};
    return { metrics };
  }
}
