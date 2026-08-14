import { BlueskyClient, parseAtUri } from "./client";
import type { BlueskyConfig, BlueskySession, CreateRecordResult } from "../types/index";

const POST_COLLECTION = "app.bsky.feed.post";

export interface CreatePostOptions {
  text: string;
  /** at:// URI of the post being replied to (the social SDK passes the parent uri). */
  replyToUri?: string;
  /** Optional embed (e.g. images) built by the caller. */
  embed?: Record<string, unknown>;
  createdAt?: string;
}

/**
 * Main Bluesky (AT Protocol) connector class.
 */
export class Bluesky {
  private readonly client: BlueskyClient;

  constructor(config: BlueskyConfig) {
    this.client = new BlueskyClient(config);
  }

  static fromEnv(): Bluesky {
    const identifier = process.env.BLUESKY_IDENTIFIER;
    const appPassword = process.env.BLUESKY_APP_PASSWORD;
    const pds = process.env.BLUESKY_PDS;
    if (!identifier || !appPassword) {
      throw new Error("BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD environment variables are required");
    }
    return new Bluesky({ identifier, appPassword, pds });
  }

  /** Resolve the authenticated account (did + handle). */
  async me(): Promise<BlueskySession> {
    return this.client.ensureSession();
  }

  /**
   * Create a feed post. For replies, we resolve the root of the thread so the
   * reply ref carries both parent and root strong-refs (AT Protocol requirement).
   */
  async createPost(options: CreatePostOptions): Promise<CreateRecordResult> {
    const record: Record<string, unknown> = {
      $type: POST_COLLECTION,
      text: options.text,
      createdAt: options.createdAt || new Date().toISOString(),
    };

    if (options.embed) {
      record.embed = options.embed;
    }

    if (options.replyToUri) {
      const { parent, root } = await this.resolveReplyRefs(options.replyToUri);
      record.reply = { root, parent };
    }

    return this.client.createRecord(POST_COLLECTION, record);
  }

  async deletePost(uri: string): Promise<void> {
    return this.client.deleteRecord(uri);
  }

  /** Upload an image/video blob and return a strong blob ref. */
  async uploadBlob(data: Buffer | Uint8Array, mimeType: string): Promise<unknown> {
    const res = await this.client.uploadBlob(data, mimeType);
    return res.blob;
  }

  async listNotifications(options?: { limit?: number; cursor?: string }) {
    return this.client.listNotifications(options);
  }

  async getPosts(uris: string[]) {
    return this.client.getPosts(uris);
  }

  getClient(): BlueskyClient {
    return this.client;
  }

  /**
   * Resolve the strong-refs needed for a reply: the parent ref ({uri,cid}) and the
   * thread root. If the parent is itself a reply, its record carries the thread
   * root; otherwise the parent IS the root. This keeps deep threads correctly
   * rooted per the AT Protocol app.bsky.feed.post reply schema.
   */
  private async resolveReplyRefs(parentUri: string): Promise<{
    parent: { uri: string; cid: string };
    root: { uri: string; cid: string };
  }> {
    parseAtUri(parentUri);
    const posts = await this.client.getPosts([parentUri]);
    const match = posts.posts.find((p) => p.uri === parentUri);
    if (!match || !match.cid) {
      throw new Error(`Cannot resolve parent post for reply: ${parentUri}`);
    }
    const parent = { uri: match.uri, cid: match.cid };
    const root = match.record?.reply?.root ?? parent;
    return { parent, root };
  }
}

export { BlueskyClient, parseAtUri } from "./client";
export type { BlueskyConfig, BlueskySession, CreateRecordResult } from "../types/index";
