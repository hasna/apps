// @generated from openapi/loops.json by scripts/gen-sdk.ts — DO NOT EDIT.
// Regenerate: bun run scripts/gen-sdk.ts
// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: OpenLoops 0.4.14

export interface Foundation { "status": string; "version": string; "mode": string; "service"?: string; "detail"?: string }

export interface Loop { "id": string; "name": string; "description"?: string | null; "status": string; "schedule"?: Record<string, unknown>; "target"?: Record<string, unknown>; "nextRunAt"?: string | null; "createdAt"?: string; "updatedAt"?: string }

export interface CreateLoopInput { "name": string; "description"?: string; "schedule": Record<string, unknown>; "target": Record<string, unknown> }

export interface UpdateLoopInput { "status"?: "active" | "paused" | "stopped" | "expired"; "nextRunAt"?: string | null; "retryScheduledFor"?: string | null; "expiresAt"?: string | null }

export interface Run { "id": string; "loopId": string; "status": string; "attempt"?: number; "scheduledFor"?: string; "startedAt"?: string | null; "finishedAt"?: string | null }

export interface LoopResponse { "ok": boolean; "loop": Loop }

export interface LoopListResponse { "ok": boolean; "loops": Array<Loop> }

export interface RunResponse { "ok": boolean; "run": Run }

export interface RunListResponse { "ok": boolean; "runs": Array<Run> }

export interface DeleteResponse { "ok": boolean; "deleted": boolean }

export interface LoopsClientOptions {
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

export class LoopsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: LoopsClientOptions) {
    if (!options.baseUrl) throw new Error("LoopsClient requires a baseUrl.");
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

    /** Liveness probe */
    async healthCheck(init?: RequestInit): Promise<Foundation> {
      return this.request("GET", `/health`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Readiness probe (storage reachable + migrated) */
    async readyCheck(init?: RequestInit): Promise<Foundation> {
      return this.request("GET", `/ready`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List loops */
    async listLoops(query?: { "status"?: "active" | "paused" | "stopped" | "expired"; "limit"?: number; "includeArchived"?: boolean; "archived"?: boolean }, init?: RequestInit): Promise<LoopListResponse> {
      return this.request("GET", `/v1/loops`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create a loop */
    async createLoop(body: CreateLoopInput, init?: RequestInit): Promise<LoopResponse> {
      return this.request("POST", `/v1/loops`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a loop by id */
    async getLoop(id: string, init?: RequestInit): Promise<LoopResponse> {
      return this.request("GET", `/v1/loops/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a loop */
    async deleteLoop(id: string, init?: RequestInit): Promise<DeleteResponse> {
      return this.request("DELETE", `/v1/loops/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Update a loop (status / schedule fields) */
    async updateLoop(id: string, body: UpdateLoopInput, init?: RequestInit): Promise<LoopResponse> {
      return this.request("PATCH", `/v1/loops/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Archive a loop */
    async archiveLoop(id: string, init?: RequestInit): Promise<LoopResponse> {
      return this.request("POST", `/v1/loops/${encodeURIComponent(String(id))}/archive`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Unarchive a loop */
    async unarchiveLoop(id: string, init?: RequestInit): Promise<LoopResponse> {
      return this.request("POST", `/v1/loops/${encodeURIComponent(String(id))}/unarchive`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List runs */
    async listRuns(query?: { "loopId"?: string; "status"?: string; "limit"?: number }, init?: RequestInit): Promise<RunListResponse> {
      return this.request("GET", `/v1/runs`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Get a run by id */
    async getRun(id: string, init?: RequestInit): Promise<RunResponse> {
      return this.request("GET", `/v1/runs/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Service version */
    async getVersion(init?: RequestInit): Promise<Foundation> {
      return this.request("GET", `/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
