import {
  BlueskyApiError,
  type AtUriRef,
  type BlueskyConfig,
  type BlueskySession,
  type CreateRecordResult,
} from "../types/index";

const DEFAULT_PDS = "https://bsky.social";

/**
 * Minimal AT Protocol (Bluesky) transport — raw fetch, zero dependencies, no fs.
 *
 * Credentials are passed in per construction; the session is created lazily on the
 * first authenticated call (com.atproto.server.createSession). Nothing is persisted.
 */
export class BlueskyClient {
  private readonly identifier: string;
  private readonly appPassword: string;
  private readonly pds: string;
  private session?: BlueskySession;

  constructor(config: BlueskyConfig) {
    if (!config?.identifier || !config?.appPassword) {
      throw new Error("bluesky credentials require `identifier` and `appPassword`");
    }
    this.identifier = config.identifier;
    this.appPassword = config.appPassword;
    this.pds = (config.pds || DEFAULT_PDS).replace(/\/+$/, "");
  }

  private async xrpc<T>(
    nsid: string,
    options: {
      method?: "GET" | "POST";
      params?: Record<string, string | number | undefined>;
      body?: unknown;
      auth?: boolean;
      contentType?: string;
      rawBody?: BodyInit;
    } = {},
  ): Promise<T> {
    const { method = "GET", params, body, auth = true, contentType, rawBody } = options;

    const url = new URL(`${this.pds}/xrpc/${nsid}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") url.searchParams.append(k, String(v));
      }
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (auth) {
      const session = await this.ensureSession();
      headers.Authorization = `Bearer ${session.accessJwt}`;
    }

    const init: RequestInit = { method, headers };
    if (rawBody !== undefined) {
      headers["Content-Type"] = contentType || "application/octet-stream";
      init.body = rawBody;
    } else if (body !== undefined && method !== "GET") {
      headers["Content-Type"] = contentType || "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), init);

    if (response.status === 204) return {} as T;

    let data: unknown;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const errBody = (typeof data === "object" && data !== null ? data : {}) as {
        error?: string;
        message?: string;
      };
      const message = errBody.message || errBody.error || response.statusText || "Request failed";
      throw new BlueskyApiError(message, response.status, errBody.error);
    }

    return data as T;
  }

  /** Create (or return cached) a session via com.atproto.server.createSession. */
  async ensureSession(): Promise<BlueskySession> {
    if (this.session) return this.session;
    const session = await this.xrpc<BlueskySession>("com.atproto.server.createSession", {
      method: "POST",
      auth: false,
      body: { identifier: this.identifier, password: this.appPassword },
    });
    this.session = session;
    return session;
  }

  /** Create a record in the authenticated user's repo. */
  async createRecord(collection: string, record: Record<string, unknown>): Promise<CreateRecordResult> {
    const session = await this.ensureSession();
    return this.xrpc<CreateRecordResult>("com.atproto.repo.createRecord", {
      method: "POST",
      body: { repo: session.did, collection, record },
    });
  }

  /** Delete a record by its at:// URI (parses repo/collection/rkey). */
  async deleteRecord(uri: string): Promise<void> {
    const session = await this.ensureSession();
    const parsed = parseAtUri(uri);
    await this.xrpc("com.atproto.repo.deleteRecord", {
      method: "POST",
      body: { repo: session.did, collection: parsed.collection, rkey: parsed.rkey },
    });
  }

  /** Upload a blob (image/video) — returns the blob ref for embedding. */
  async uploadBlob(data: Buffer | Uint8Array, mimeType: string): Promise<{ blob: unknown }> {
    return this.xrpc<{ blob: unknown }>("com.atproto.repo.uploadBlob", {
      method: "POST",
      rawBody: data as unknown as BodyInit,
      contentType: mimeType || "application/octet-stream",
    });
  }

  /** List notifications (used for mentions). */
  async listNotifications(options?: {
    limit?: number;
    cursor?: string;
  }): Promise<{
    notifications: Array<{
      uri: string;
      cid: string;
      reason: string;
      indexedAt?: string;
      author?: { did: string; handle: string };
      record?: { text?: string; createdAt?: string };
    }>;
    cursor?: string;
  }> {
    return this.xrpc("app.bsky.notification.listNotifications", {
      method: "GET",
      params: { limit: options?.limit, cursor: options?.cursor },
    });
  }

  /** Fetch hydrated posts by URI (used for analytics/metrics + reply refs). */
  async getPosts(uris: string[]): Promise<{
    posts: Array<{
      uri: string;
      cid?: string;
      likeCount?: number;
      repostCount?: number;
      replyCount?: number;
      quoteCount?: number;
      record?: { reply?: { root?: { uri: string; cid: string } } };
    }>;
  }> {
    const url = new URL(`${this.pds}/xrpc/app.bsky.feed.getPosts`);
    for (const u of uris) url.searchParams.append("uris", u);
    const session = await this.ensureSession();
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json", Authorization: `Bearer ${session.accessJwt}` },
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new BlueskyApiError(data?.message || data?.error || response.statusText, response.status, data?.error);
    }
    return data;
  }

  getSession(): BlueskySession | undefined {
    return this.session;
  }
}

/** Parse an at:// URI into its components. */
export function parseAtUri(uri: string): { repo: string; collection: string; rkey: string } {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) {
    throw new Error(`Invalid at:// URI: ${uri}`);
  }
  return { repo: match[1]!, collection: match[2]!, rkey: match[3]! };
}

export type { AtUriRef };
