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
    const url = this.url("v1/feedback");
    if (filter.appId) url.searchParams.set("appId", filter.appId);
    if (filter.status) url.searchParams.set("status", filter.status);
    if (filter.tag) url.searchParams.set("tag", filter.tag);
    if (filter.limit) url.searchParams.set("limit", String(filter.limit));
    return readJson<FeedbackItem[]>(await this.request(url));
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

  private url(path: string): URL {
    return new URL(path, this.baseUrl);
  }

  private async request(pathOrUrl: string | URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    return this.fetchImpl(pathOrUrl instanceof URL ? pathOrUrl : this.url(pathOrUrl), {
      ...init,
      headers,
    });
  }
}

export function createFeedbackClient(options: FeedbackClientOptions): FeedbackClient {
  return new FeedbackClient(options);
}

