// @generated from the @hasna/logs serve OpenAPI by scripts/generate-sdk-api.ts.
// DO NOT EDIT. Regenerate: bun scripts/generate-sdk-api.ts

// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: Logs 0.4.8

export interface Project { "id": string; "name": string; "github_repo"?: string | null; "base_url"?: string | null; "description"?: string | null; "created_at": string }

export interface CreateProject { "name": string; "github_repo"?: string | null; "base_url"?: string | null; "description"?: string | null }

export interface LogRecord { "id": string; "timestamp": string; "project_id"?: string | null; "page_id"?: string | null; "level": "debug" | "info" | "warn" | "error" | "fatal"; "source": string; "service"?: string | null; "message": string; "trace_id"?: string | null; "session_id"?: string | null; "agent"?: string | null; "url"?: string | null; "stack_trace"?: string | null; "metadata"?: Record<string, unknown> | null; "source_event_id"?: string | null; "machine_id"?: string | null; "repo_id"?: string | null; "app_id"?: string | null; "process_id"?: string | null; "run_id"?: string | null; "span_id"?: string | null; "parent_span_id"?: string | null; "release_id"?: string | null; "environment"?: string | null; "privacy"?: string | null }

export interface CreateLog { "id"?: string; "level": "debug" | "info" | "warn" | "error" | "fatal"; "message": string; "project_id"?: string | null; "page_id"?: string | null; "source"?: string | null; "service"?: string | null; "trace_id"?: string | null; "session_id"?: string | null; "agent"?: string | null; "url"?: string | null; "stack_trace"?: string | null; "metadata"?: Record<string, unknown> | null; "timestamp"?: string | null; "source_event_id"?: string | null; "machine_id"?: string | null; "repo_id"?: string | null; "app_id"?: string | null; "process_id"?: string | null; "run_id"?: string | null; "span_id"?: string | null; "parent_span_id"?: string | null; "release_id"?: string | null; "environment"?: string | null; "privacy"?: string | null }

export interface ProjectList { "projects": Array<Project> }

export interface LogList { "logs": Array<LogRecord> }

export interface DeleteResult { "deleted": boolean; "id": string }

export interface ErrorResponse { "error": string; "reason"?: string }

export interface LogsClientOptions {
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

export class LogsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: LogsClientOptions) {
    if (!options.baseUrl) throw new Error("LogsClient requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseHeaders = options.headers ?? {};
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
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

    /** Search logs */
    async listLogs(query?: { "project_id"?: string; "level"?: string; "service"?: string; "trace_id"?: string; "q"?: string; "limit"?: number }, init?: RequestInit): Promise<LogList> {
      return this.request("GET", `/v1/logs`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Ingest a log entry */
    async ingestLog(body: CreateLog, init?: RequestInit): Promise<LogRecord> {
      return this.request("POST", `/v1/logs`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a log entry by id */
    async getLog(id: string, init?: RequestInit): Promise<LogRecord> {
      return this.request("GET", `/v1/logs/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a log entry by id */
    async deleteLog(id: string, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/logs/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List projects */
    async listProjects(init?: RequestInit): Promise<ProjectList> {
      return this.request("GET", `/v1/projects`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create a project */
    async createProject(body: CreateProject, init?: RequestInit): Promise<Project> {
      return this.request("POST", `/v1/projects`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a project by id */
    async getProject(id: string, init?: RequestInit): Promise<Project> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
