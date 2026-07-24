// @generated from src/server/openapi.ts by @hasna/contracts/sdk — DO NOT EDIT.
// Regenerate: bun run build:sdk
// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: FilesClient 1.0.0

export interface Source { "id": string; "name": string; "type": "local" | "s3" | "google_drive"; "path"?: string | null; "bucket"?: string | null; "prefix"?: string | null; "region"?: string | null; "config"?: Record<string, unknown>; "machine_id": string; "enabled": boolean; "file_count": number; "created_at": string; "updated_at": string }

export interface CreateSource { "type"?: "local" | "s3" | "google_drive"; "name"?: string; "path"?: string; "bucket"?: string; "prefix"?: string; "region"?: string; "config"?: Record<string, unknown>; "machine_id"?: string }

export interface UpdateSource { "name"?: string; "enabled"?: boolean; "path"?: string; "bucket"?: string; "prefix"?: string; "region"?: string; "config"?: Record<string, unknown> }

export interface File { "id": string; "source_id": string; "machine_id": string; "path": string; "name": string; "ext": string; "size": number; "mime": string; "hash"?: string | null; "status": "active" | "deleted" | "moved"; "indexed_at"?: string; "created_at"?: string; "tags": Array<string> }

export interface Tag { "id": string; "name": string; "color": string; "created_at"?: string }

export interface Collection { "id": string; "name": string; "description": string; "created_at"?: string; "updated_at"?: string }

export interface Project { "id": string; "name": string; "description": string; "status"?: string; "created_at"?: string; "updated_at"?: string }

export interface Machine { "id": string; "name": string; "hostname"?: string; "platform"?: string; "arch"?: string; "is_current"?: boolean }

export interface NameBody { "name": string; "description"?: string }

export interface FileIdBody { "file_id": string }

export interface TagsBody { "tags": Array<string> }

export interface Ok { "ok": boolean }

export interface Stats { "total_files": number; "total_size": number; "by_ext"?: Array<Record<string, unknown>>; "by_source"?: Array<Record<string, unknown>> }

export interface FilesClientOptions {
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

export class FilesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: FilesClientOptions) {
    if (!options.baseUrl) throw new Error("FilesClient requires a baseUrl.");
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

    /** List collections */
    async listCollections(init?: RequestInit): Promise<Array<Collection>> {
      return this.request("GET", `/collections`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create a collection */
    async createCollection(body: NameBody, init?: RequestInit): Promise<Collection> {
      return this.request("POST", `/collections`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Add a file to a collection */
    async addToCollection(id: string, body: FileIdBody, init?: RequestInit): Promise<Ok> {
      return this.request("POST", `/collections/${encodeURIComponent(String(id))}/files`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Remove a file from a collection */
    async removeFromCollection(id: string, fileId: string, init?: RequestInit): Promise<Ok> {
      return this.request("DELETE", `/collections/${encodeURIComponent(String(id))}/files/${encodeURIComponent(String(fileId))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List / search files */
    async listFiles(query?: { "source_id"?: string; "ext"?: string; "q"?: string; "status"?: string; "limit"?: number; "offset"?: number }, init?: RequestInit): Promise<Array<File>> {
      return this.request("GET", `/files`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Get a file */
    async getFile(id: string, init?: RequestInit): Promise<File> {
      return this.request("GET", `/files/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Add tags to a file */
    async addFileTags(id: string, body: TagsBody, init?: RequestInit): Promise<Ok> {
      return this.request("POST", `/files/${encodeURIComponent(String(id))}/tags`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Remove tags from a file */
    async removeFileTags(id: string, body: TagsBody, init?: RequestInit): Promise<Ok> {
      return this.request("DELETE", `/files/${encodeURIComponent(String(id))}/tags`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List machines */
    async listMachines(init?: RequestInit): Promise<Array<Machine>> {
      return this.request("GET", `/machines`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List projects */
    async listProjects(init?: RequestInit): Promise<Array<Project>> {
      return this.request("GET", `/projects`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create a project */
    async createProject(body: NameBody, init?: RequestInit): Promise<Project> {
      return this.request("POST", `/projects`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Add a file to a project */
    async addToProject(id: string, body: FileIdBody, init?: RequestInit): Promise<Ok> {
      return this.request("POST", `/projects/${encodeURIComponent(String(id))}/files`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Remove a file from a project */
    async removeFromProject(id: string, fileId: string, init?: RequestInit): Promise<Ok> {
      return this.request("DELETE", `/projects/${encodeURIComponent(String(id))}/files/${encodeURIComponent(String(fileId))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List sources */
    async listSources(query?: { "machine_id"?: string }, init?: RequestInit): Promise<Array<Source>> {
      return this.request("GET", `/sources`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create a source */
    async createSource(body: CreateSource, init?: RequestInit): Promise<Source> {
      return this.request("POST", `/sources`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a source */
    async getSource(id: string, init?: RequestInit): Promise<Source> {
      return this.request("GET", `/sources/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a source */
    async deleteSource(id: string, init?: RequestInit): Promise<Ok> {
      return this.request("DELETE", `/sources/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Update a source (rename/enable/disable/reconfigure) */
    async updateSource(id: string, body: UpdateSource, init?: RequestInit): Promise<Source> {
      return this.request("PATCH", `/sources/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Aggregate file stats */
    async getStats(init?: RequestInit): Promise<Stats> {
      return this.request("GET", `/stats`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List tags */
    async listTags(init?: RequestInit): Promise<Array<Tag>> {
      return this.request("GET", `/tags`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
