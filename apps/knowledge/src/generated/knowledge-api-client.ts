// @generated from the knowledge-serve OpenAPI document by scripts/generate-sdk.mjs.
// DO NOT EDIT. Regenerate: bun scripts/generate-sdk.mjs

// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: Knowledge 0.2.84

export interface Note { "id": string; "short_id"?: string | null; "title": string; "content": string; "url"?: string | null; "tags": Array<string>; "metadata"?: Record<string, unknown>; "archived": boolean; "created_at": string; "updated_at": string }

export interface NoteInput { "title": string; "content"?: string; "url"?: string | null; "tags"?: Array<string>; "metadata"?: Record<string, unknown> }

export interface NotePatch { "title"?: string; "content"?: string; "url"?: string | null; "tags"?: Array<string>; "metadata"?: Record<string, unknown>; "archived"?: boolean }

export interface NoteList { "items": Array<Note>; "total": number }

export interface KnowledgeApiClientOptions {
  /** Base URL, e.g. process.env.APP_API_URL. */
  baseUrl: string;
  /** API key, e.g. process.env.APP_API_KEY. Sent as the 'x-api-key' header. */
  apiKey?: string;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class KnowledgeApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: KnowledgeApiClientOptions) {
    if (!options.baseUrl) throw new Error("KnowledgeApiClient requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseHeaders = options.headers ?? {};
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { Accept: "application/json", ...this.baseHeaders, ...(opts.init?.headers as Record<string, string> | undefined) };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    let payload: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }
    const response = await this.fetchImpl(url.toString(), { ...opts.init, method, headers, body: payload });
    const text = await response.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
    if (!response.ok) {
      throw new ApiError(response.status, `${method} ${path} failed: ${response.status}`, data);
    }
    return data as T;
  }

    /** List knowledge items */
    async listNotes(query?: { "limit"?: number; "offset"?: number; "search"?: string }, init?: RequestInit): Promise<NoteList> {
      return this.request("GET", `/v1/notes`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create a knowledge item */
    async createNote(body: NoteInput, init?: RequestInit): Promise<Note> {
      return this.request("POST", `/v1/notes`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Fetch a knowledge item */
    async getNote(id: string, init?: RequestInit): Promise<Note> {
      return this.request("GET", `/v1/notes/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a knowledge item */
    async deleteNote(id: string, init?: RequestInit): Promise<void> {
      return this.request("DELETE", `/v1/notes/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Update a knowledge item */
    async updateNote(id: string, body: NotePatch, init?: RequestInit): Promise<Note> {
      return this.request("PATCH", `/v1/notes/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Knowledge registry contract */
    async getRegistry(init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/registry`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
