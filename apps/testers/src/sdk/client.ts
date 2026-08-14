// @generated from the testers OpenAPI document by scripts/generate-sdk.ts — DO NOT EDIT.
// Regenerate: bun run scripts/generate-sdk.ts

// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: Testers API 0.0.78

export interface Health { "status": string; "version": string; "mode": string }

export interface Ready { "status": string; "version": string; "mode": string; "pendingMigrations"?: Array<string> }

export interface Project { "id"?: string; "name"?: string; "description"?: string; "baseUrl"?: string; "createdAt"?: string; "updatedAt"?: string }

export interface CreateProject { "name": string; "path"?: string; "description"?: string; "baseUrl"?: string; "port"?: number; "scenarioPrefix"?: string }

export interface Scenario { "id"?: string; "shortId"?: string; "projectId"?: string; "name"?: string; "description"?: string; "steps"?: Array<string>; "tags"?: Array<string>; "priority"?: string; "version"?: number; "createdAt"?: string; "updatedAt"?: string }

export interface CreateScenario { "name": string; "description"?: string; "steps"?: Array<string>; "tags"?: Array<string>; "priority"?: "low" | "medium" | "high" | "critical"; "projectId"?: string; "requiresAuth"?: boolean }

export interface Run { "id"?: string; "projectId"?: string; "status"?: string; "url"?: string; "model"?: string; "total"?: number; "passed"?: number; "failed"?: number; "startedAt"?: string; "finishedAt"?: string }

export interface CreateRun { "url": string; "model"?: string; "projectId"?: string }

export interface Result { "id"?: string; "runId"?: string; "scenarioId"?: string; "status"?: string; "reasoning"?: string; "error"?: string; "durationMs"?: number; "createdAt"?: string }

export interface Persona { "id"?: string; "shortId"?: string; "projectId"?: string; "name"?: string; "role"?: string; "description"?: string; "enabled"?: boolean; "version"?: number; "createdAt"?: string; "updatedAt"?: string }

export interface CreatePersona { "name": string; "role": string; "description"?: string; "instructions"?: string; "traits"?: Array<string>; "goals"?: Array<string>; "projectId"?: string }

export interface DeleteResult { "deleted": boolean }

export interface TestersClientOptions {
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

export class TestersClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: TestersClientOptions) {
    if (!options.baseUrl) throw new Error("TestersClient requires a baseUrl.");
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
    async getHealth(init?: RequestInit): Promise<Health> {
      return this.request("GET", `/health`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Readiness probe */
    async getReady(init?: RequestInit): Promise<Ready> {
      return this.request("GET", `/ready`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List personas */
    async listPersonas(query?: { "projectId"?: string }, init?: RequestInit): Promise<Array<Persona>> {
      return this.request("GET", `/v1/personas`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create persona */
    async createPersona(body: CreatePersona, init?: RequestInit): Promise<Persona> {
      return this.request("POST", `/v1/personas`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get persona */
    async getPersona(id: string, init?: RequestInit): Promise<Persona> {
      return this.request("GET", `/v1/personas/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Update persona */
    async updatePersona(id: string, body: CreatePersona, init?: RequestInit): Promise<Persona> {
      return this.request("PUT", `/v1/personas/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Delete persona */
    async deletePersona(id: string, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/personas/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List projects */
    async listProjects(init?: RequestInit): Promise<Array<Project>> {
      return this.request("GET", `/v1/projects`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create project */
    async createProject(body: CreateProject, init?: RequestInit): Promise<Project> {
      return this.request("POST", `/v1/projects`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get project */
    async getProject(id: string, init?: RequestInit): Promise<Project> {
      return this.request("GET", `/v1/projects/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Update project */
    async updateProject(id: string, body: CreateProject, init?: RequestInit): Promise<Project> {
      return this.request("PUT", `/v1/projects/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get result */
    async getResult(id: string, init?: RequestInit): Promise<Result> {
      return this.request("GET", `/v1/results/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List runs */
    async listRuns(query?: { "projectId"?: string }, init?: RequestInit): Promise<Array<Run>> {
      return this.request("GET", `/v1/runs`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create run record */
    async createRun(body: CreateRun, init?: RequestInit): Promise<Run> {
      return this.request("POST", `/v1/runs`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get run */
    async getRun(id: string, init?: RequestInit): Promise<Run> {
      return this.request("GET", `/v1/runs/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List results for a run */
    async listRunResults(id: string, init?: RequestInit): Promise<Array<Result>> {
      return this.request("GET", `/v1/runs/${encodeURIComponent(String(id))}/results`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List scenarios */
    async listScenarios(query?: { "projectId"?: string; "limit"?: number }, init?: RequestInit): Promise<Array<Scenario>> {
      return this.request("GET", `/v1/scenarios`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create scenario */
    async createScenario(body: CreateScenario, init?: RequestInit): Promise<Scenario> {
      return this.request("POST", `/v1/scenarios`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get scenario */
    async getScenario(id: string, init?: RequestInit): Promise<Scenario> {
      return this.request("GET", `/v1/scenarios/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Update scenario */
    async updateScenario(id: string, body: CreateScenario, init?: RequestInit): Promise<Scenario> {
      return this.request("PUT", `/v1/scenarios/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Delete scenario */
    async deleteScenario(id: string, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/scenarios/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Service version */
    async getVersion(init?: RequestInit): Promise<Health> {
      return this.request("GET", `/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
