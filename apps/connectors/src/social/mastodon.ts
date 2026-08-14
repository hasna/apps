/**
 * Mastodon adapter for the stateless social SDK.
 *
 * The existing connectors/mastodon scaffold has no inline-credential transport, so
 * we implement a minimal raw-fetch transport here against the Mastodon REST API
 * (`${baseUrl}/api/v1/...`) with a Bearer access token. Bundle-safe (fetch only).
 */
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

/** Injectable fetch so tests can mock the network. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: unknown },
) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  text(): Promise<string>;
}>;

export interface MastodonCredentials {
  accessToken: string;
  baseUrl: string;
}

export class MastodonAdapter implements SocialAdapter {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(creds: MastodonCredentials, fetchImpl?: FetchLike) {
    if (!creds || !creds.accessToken || !creds.baseUrl) {
      throw new Error("mastodon credentials require `accessToken` and `baseUrl`");
    }
    this.accessToken = creds.accessToken;
    this.baseUrl = creds.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  static fromCredentials(creds: MastodonCredentials, fetchImpl?: FetchLike): MastodonAdapter {
    return new MastodonAdapter(creds, fetchImpl);
  }

  private async call<T>(
    path: string,
    options: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const { method = "GET", body, query } = options;
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") qs.append(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/json",
    };
    let serializedBody: unknown;
    if (body !== undefined && method !== "GET") {
      headers["Content-Type"] = "application/json";
      serializedBody = JSON.stringify(body);
    }
    const res = await this.fetchImpl(url, { method, headers, body: serializedBody });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const message = (data && (data.error || data.message)) || res.statusText || "Mastodon request failed";
      throw new Error(`Mastodon ${res.status}: ${message}`);
    }
    return data as T;
  }

  async accountMe(): Promise<AccountMeResult> {
    const acct = await this.call<{ id: string; username: string; display_name?: string; url?: string }>(
      "/api/v1/accounts/verify_credentials",
    );
    return {
      id: acct.id,
      username: acct.username,
      displayName: acct.display_name,
      url: acct.url,
    };
  }

  async postCreate(input: PostCreateInput): Promise<PostCreateResult> {
    const body: Record<string, unknown> = { status: input.text };
    if (input.replyToId) body.in_reply_to_id = input.replyToId;
    if (input.mediaIds && input.mediaIds.length > 0) body.media_ids = input.mediaIds;
    const status = await this.call<{ id: string; url?: string }>("/api/v1/statuses", {
      method: "POST",
      body,
    });
    return { id: status.id, url: status.url };
  }

  async postDelete(input: PostDeleteInput): Promise<PostDeleteResult> {
    await this.call(`/api/v1/statuses/${input.id}`, { method: "DELETE" });
    return { id: input.id, deleted: true };
  }

  async mediaUpload(input: MediaUploadInput): Promise<{ mediaId: string }> {
    // Mastodon v2 media endpoint accepts multipart; we post the decoded buffer.
    const buffer = decodeBase64(input.dataBase64);
    const form = new FormData();
    // Copy into a fresh ArrayBuffer-backed Uint8Array so the BlobPart type is
    // satisfied (Buffer's backing store is typed as ArrayBufferLike, which the
    // strict Blob/BlobPart lib types reject).
    const bytes = Uint8Array.from(buffer);
    const blob = new Blob([bytes], { type: input.mimeType });
    form.append("file", blob);
    if (input.altText) form.append("description", input.altText);
    const res = await this.fetchImpl(`${this.baseUrl}/api/v2/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
      body: form,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const message = (data && (data.error || data.message)) || res.statusText || "media upload failed";
      throw new Error(`Mastodon ${res.status}: ${message}`);
    }
    return { mediaId: String(data.id) };
  }

  async mentionsList(input: MentionsListInput = {}): Promise<MentionsListResult> {
    const notifications = await this.call<
      Array<{
        type: string;
        status?: {
          id: string;
          content?: string;
          created_at?: string;
          account?: { id: string; acct: string };
        };
      }>
    >("/api/v1/notifications", {
      query: { types: "mention", since_id: input.sinceId, limit: input.limit },
    });
    const items = notifications
      .filter((n) => n.type === "mention" && n.status)
      .map((n) => ({
        id: n.status!.id,
        text: stripHtml(n.status!.content ?? ""),
        authorId: n.status!.account?.id,
        authorHandle: n.status!.account?.acct,
        createdAt: n.status!.created_at,
      }));
    return { items };
  }

  async analyticsPost(input: AnalyticsPostInput): Promise<AnalyticsPostResult> {
    const status = await this.call<{
      reblogs_count?: number;
      favourites_count?: number;
      replies_count?: number;
    }>(`/api/v1/statuses/${input.id}`);
    return {
      metrics: {
        reblogsCount: status.reblogs_count ?? 0,
        favouritesCount: status.favourites_count ?? 0,
        repliesCount: status.replies_count ?? 0,
      },
    };
  }
}

/** Mastodon status content is HTML; strip tags for the normalized `text` field. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
