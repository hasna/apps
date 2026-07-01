import type {
  FeedbackInput,
  FeedbackItem,
  FeedbackListFilter,
  FeedbackStats,
  FeedbackStatus,
} from "./types.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface FeedbackClientOptions {
  baseUrl: string;
  token?: string;
  fetch?: FetchLike;
}

function hasUrlScheme(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value);
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value ? String((value as { error: unknown }).error) : response.statusText;
    throw new Error(message);
  }
  return value as T;
}

export class FeedbackClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: FeedbackClientOptions) {
    this.baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    this.token = options.token;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async submit(input: FeedbackInput): Promise<FeedbackItem> {
    return readJson<FeedbackItem>(
      await this.request("v1/feedback", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  }

  async list(filter: FeedbackListFilter = {}): Promise<FeedbackItem[]> {
    return readJson<FeedbackItem[]>(await this.request(this.url("v1/feedback", filter)));
  }

  async get(id: string): Promise<FeedbackItem> {
    return readJson<FeedbackItem>(await this.request(`v1/feedback/${encodeURIComponent(id)}`));
  }

  async updateStatus(id: string, status: FeedbackStatus): Promise<FeedbackItem> {
    return readJson<FeedbackItem>(
      await this.request(`v1/feedback/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    );
  }

  async stats(): Promise<FeedbackStats> {
    return readJson<FeedbackStats>(await this.request("v1/stats"));
  }

  async exportJsonl(filter: FeedbackListFilter = {}): Promise<string> {
    const response = await this.request(this.url("v1/export.jsonl", filter));
    const text = await response.text();
    if (!response.ok) {
      try {
        const value = text ? JSON.parse(text) : null;
        const message = value && typeof value === "object" && "error" in value ? String((value as { error: unknown }).error) : response.statusText;
        throw new Error(message);
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error(response.statusText);
        throw error;
      }
    }
    return text;
  }

  private url(path: string, filter: FeedbackListFilter = {}): URL | string {
    const cleanPath = path.replace(/^\/+/, "");
    const params = new URLSearchParams();
    if (filter.appId) params.set("appId", filter.appId);
    if (filter.status) params.set("status", filter.status);
    if (filter.tag) params.set("tag", filter.tag);
    if (filter.limit) params.set("limit", String(filter.limit));

    if (hasUrlScheme(this.baseUrl)) {
      const url = new URL(cleanPath, this.baseUrl);
      for (const [key, value] of params) url.searchParams.set(key, value);
      return url;
    }

    const query = params.toString();
    const relativeUrl = `${this.baseUrl}${cleanPath}`;
    return query ? `${relativeUrl}?${query}` : relativeUrl;
  }

  private async request(pathOrUrl: string | URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    const requestUrl =
      pathOrUrl instanceof URL || pathOrUrl.startsWith("/") || hasUrlScheme(pathOrUrl)
        ? pathOrUrl
        : this.url(pathOrUrl);
    return this.fetchImpl(requestUrl, {
      ...init,
      headers,
    });
  }
}

export function createFeedbackClient(options: FeedbackClientOptions): FeedbackClient {
  return new FeedbackClient(options);
}
