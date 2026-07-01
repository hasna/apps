import type {
  ChangelogEntry,
  ChangelogEntryInput,
  ChangelogEntryListFilter,
  ChangelogEntryUpdate,
  ChangelogStats,
  PublishChangelogResult,
} from "./types.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ChangelogClientOptions {
  baseUrl: string;
  token?: string;
  fetch?: FetchLike;
}

export interface ChangelogGenerateRequest extends ChangelogEntryListFilter {
  title?: string;
}

export interface ChangelogPublishRequest {
  appId?: string;
  version?: string;
  kind?: ChangelogEntryListFilter["kind"];
  category?: ChangelogEntryListFilter["category"];
  tag?: string;
  limit?: number;
  title?: string;
  targetPath?: string;
  write?: boolean;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value
      ? String((value as { error: unknown }).error)
      : response.statusText;
    throw new Error(message);
  }
  return value as T;
}

async function readText(response: Response): Promise<string> {
  const text = await response.text();
  if (!response.ok) throw new Error(text || response.statusText);
  return text;
}

function applyFilterParams(url: URL, filter: ChangelogEntryListFilter): void {
  if (filter.appId) url.searchParams.set("appId", filter.appId);
  if (filter.version) url.searchParams.set("version", filter.version);
  if (filter.kind) url.searchParams.set("kind", filter.kind);
  if (filter.category) url.searchParams.set("category", filter.category);
  if (filter.tag) url.searchParams.set("tag", filter.tag);
  if (filter.limit) url.searchParams.set("limit", String(filter.limit));
}

export class ChangelogClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: ChangelogClientOptions) {
    this.baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    this.token = options.token;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async health(): Promise<{ ok: boolean; service: string; version: string }> {
    return readJson(await this.request("health"));
  }

  async add(input: ChangelogEntryInput): Promise<ChangelogEntry> {
    return readJson<ChangelogEntry>(
      await this.request("v1/entries", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  }

  async list(filter: ChangelogEntryListFilter = {}): Promise<ChangelogEntry[]> {
    const url = this.url("v1/entries");
    applyFilterParams(url, filter);
    return readJson<ChangelogEntry[]>(await this.request(url));
  }

  async get(id: string): Promise<ChangelogEntry> {
    return readJson<ChangelogEntry>(await this.request(`v1/entries/${encodeURIComponent(id)}`));
  }

  async update(id: string, update: ChangelogEntryUpdate): Promise<ChangelogEntry> {
    return readJson<ChangelogEntry>(
      await this.request(`v1/entries/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(update),
      }),
    );
  }

  async generate(filter: ChangelogGenerateRequest = {}): Promise<string> {
    if (filter.title) {
      const response = await this.request("v1/generate", {
        method: "POST",
        body: JSON.stringify({
          appId: filter.appId,
          version: filter.version,
          kind: filter.kind,
          category: filter.category,
          tag: filter.tag,
          limit: filter.limit,
          title: filter.title,
        }),
      });
      const value = await readJson<{ markdown: string }>(response);
      return value.markdown;
    }
    const url = this.url("v1/generate");
    applyFilterParams(url, filter);
    return readText(await this.request(url));
  }

  async publish(options: ChangelogPublishRequest = {}): Promise<PublishChangelogResult> {
    return readJson<PublishChangelogResult>(
      await this.request("v1/publish", {
        method: "POST",
        body: JSON.stringify(options),
      }),
    );
  }

  async stats(): Promise<ChangelogStats> {
    return readJson<ChangelogStats>(await this.request("v1/stats"));
  }

  async exportJsonl(filter: ChangelogEntryListFilter = {}): Promise<string> {
    const url = this.url("v1/export.jsonl");
    applyFilterParams(url, filter);
    return readText(await this.request(url));
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

export function createChangelogClient(options: ChangelogClientOptions): ChangelogClient {
  return new ChangelogClient(options);
}
