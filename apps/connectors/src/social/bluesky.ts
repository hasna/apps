/**
 * Bluesky (AT Protocol) adapter for the stateless social SDK.
 *
 * Reuses the connectors/bluesky transport (raw fetch, zero deps). Bundle-safe.
 */
import { Bluesky } from "../../connectors/bluesky/src/api/index";
import { ConnectorOperationNotSupported } from "./errors";
import { decodeBase64 } from "./util";
import type {
  AccountMeResult,
  AnalyticsPostInput,
  AnalyticsPostResult,
  MediaUploadInput,
  MentionsListInput,
  MentionsListResult,
  PostCreateInput,
  PostCreateResult,
  PostDeleteInput,
  PostDeleteResult,
  SocialAdapter,
} from "./types";

/** Structural type so tests can inject a mock transport. */
export interface BlueskyTransport {
  me(): Promise<{ did: string; handle: string }>;
  createPost(opts: { text: string; replyToUri?: string; embed?: Record<string, unknown> }): Promise<{
    uri: string;
    cid: string;
  }>;
  deletePost(uri: string): Promise<void>;
  uploadBlob(data: Buffer | Uint8Array, mimeType: string): Promise<unknown>;
  listNotifications(options?: { limit?: number; cursor?: string }): Promise<{
    notifications: Array<{
      uri: string;
      reason: string;
      indexedAt?: string;
      author?: { did: string; handle: string };
      record?: { text?: string; createdAt?: string };
    }>;
  }>;
  getPosts(uris: string[]): Promise<{
    posts: Array<{
      uri: string;
      likeCount?: number;
      repostCount?: number;
      replyCount?: number;
      quoteCount?: number;
    }>;
  }>;
}

export interface BlueskyCredentials {
  identifier: string;
  appPassword: string;
  pds?: string;
}

/** Bluesky post web-URL: https://bsky.app/profile/<handle>/post/<rkey>. */
function postUrl(handle: string, uri: string): string | undefined {
  const m = /^at:\/\/[^/]+\/app\.bsky\.feed\.post\/(.+)$/.exec(uri);
  if (!m) return undefined;
  return `https://bsky.app/profile/${handle}/post/${m[1]}`;
}

export class BlueskyAdapter implements SocialAdapter {
  private readonly bsky: BlueskyTransport;
  private handle?: string;

  constructor(bsky: BlueskyTransport) {
    this.bsky = bsky;
  }

  static fromCredentials(creds: BlueskyCredentials): BlueskyAdapter {
    if (!creds || !creds.identifier || !creds.appPassword) {
      throw new Error("bluesky credentials require `identifier` and `appPassword`");
    }
    const bsky = new Bluesky({
      identifier: creds.identifier,
      appPassword: creds.appPassword,
      pds: creds.pds,
    });
    return new BlueskyAdapter(bsky as unknown as BlueskyTransport);
  }

  private async resolveHandle(): Promise<string> {
    if (this.handle) return this.handle;
    const me = await this.bsky.me();
    this.handle = me.handle;
    return this.handle;
  }

  async accountMe(): Promise<AccountMeResult> {
    const me = await this.bsky.me();
    this.handle = me.handle;
    return {
      id: me.did,
      username: me.handle,
      displayName: me.handle,
      url: `https://bsky.app/profile/${me.handle}`,
    };
  }

  async postCreate(input: PostCreateInput): Promise<PostCreateResult> {
    let embed: Record<string, unknown> | undefined;
    if (input.mediaIds && input.mediaIds.length > 0) {
      // mediaIds for bluesky are JSON-encoded blob refs produced by media.upload.
      const images = input.mediaIds.map((m) => {
        const blob = JSON.parse(m);
        return { alt: "", image: blob };
      });
      embed = { $type: "app.bsky.embed.images", images };
    }
    const res = await this.bsky.createPost({
      text: input.text,
      replyToUri: input.replyToId,
      embed,
    });
    const handle = await this.resolveHandle();
    return { id: res.uri, url: postUrl(handle, res.uri) };
  }

  async postDelete(input: PostDeleteInput): Promise<PostDeleteResult> {
    await this.bsky.deletePost(input.id);
    return { id: input.id, deleted: true };
  }

  async mediaUpload(input: MediaUploadInput): Promise<{ mediaId: string }> {
    const buffer = decodeBase64(input.dataBase64);
    const blob = await this.bsky.uploadBlob(buffer, input.mimeType);
    // Encode the blob ref as the mediaId so post.create can embed it.
    return { mediaId: JSON.stringify(blob) };
  }

  async mentionsList(input: MentionsListInput = {}): Promise<MentionsListResult> {
    const res = await this.bsky.listNotifications({ limit: input.limit });
    const items = res.notifications
      .filter((n) => n.reason === "mention" || n.reason === "reply")
      .map((n) => ({
        id: n.uri,
        text: n.record?.text ?? "",
        authorId: n.author?.did,
        authorHandle: n.author?.handle,
        createdAt: n.record?.createdAt ?? n.indexedAt,
      }));
    return { items };
  }

  async analyticsPost(input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    const res = await this.bsky.getPosts([input.id]);
    const post = res.posts.find((p) => p.uri === input.id) ?? res.posts[0];
    if (!post) {
      throw new ConnectorOperationNotSupported("bluesky", `analytics.post (post not found: ${input.id})`);
    }
    const metrics: Record<string, number> = {
      likeCount: post.likeCount ?? 0,
      repostCount: post.repostCount ?? 0,
      replyCount: post.replyCount ?? 0,
      quoteCount: post.quoteCount ?? 0,
    };
    return { metrics };
  }
}
