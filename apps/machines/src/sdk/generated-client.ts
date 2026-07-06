// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: Machines Control Plane API 0.0.63

export interface Machine { "id": string; "friendlyName"?: string | null; "platform"?: string | null; "arch"?: string | null; "status": string; "labels": Record<string, unknown>; "metadata": Record<string, unknown>; "createdAt": string; "updatedAt": string }

export interface Heartbeat { "machineId": string; "pid": number; "status": string; "updatedAt": string; "daemonVersion"?: string | null; "agentMode"?: string | null; "platform"?: string | null; "arch"?: string | null; "uptimeSeconds"?: number | null; "observedAt"?: string | null }

export interface RegisterMachineRequest { "id": string; "friendlyName"?: string | null; "platform"?: string | null; "arch"?: string | null; "status"?: string; "labels"?: Record<string, unknown>; "metadata"?: Record<string, unknown> }

export interface UpdateMachineRequest { "friendlyName"?: string | null; "platform"?: string | null; "arch"?: string | null; "status"?: string; "labels"?: Record<string, unknown>; "metadata"?: Record<string, unknown> }

export interface MachineList { "machines": Array<Machine>; "count": number }

export interface HeartbeatList { "heartbeats": Array<Heartbeat>; "count": number }

export interface DeleteResult { "deleted": boolean; "id": string }

export interface HealthResponse { "status": string; "version": string; "mode": string }

export interface ReadyResponse { "status": string; "version": string; "mode": string; "pendingMigrations"?: Array<string>; "latencyMs"?: number }

export interface ErrorResponse { "error": string; "reason"?: string }

export interface MachinesClientOptions {
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

export class MachinesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: MachinesClientOptions) {
    if (!options.baseUrl) throw new Error("MachinesClient requires a baseUrl.");
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

    /** Liveness probe (no auth). */
    async health(init?: RequestInit): Promise<HealthResponse> {
      return this.request("GET", `/health`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Readiness probe: reachable RDS and schema migrated (no auth). */
    async ready(init?: RequestInit): Promise<ReadyResponse> {
      return this.request("GET", `/ready`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List agent heartbeats across the fleet. */
    async listHeartbeats(query?: { "machineId"?: string; "limit"?: number }, init?: RequestInit): Promise<HeartbeatList> {
      return this.request("GET", `/v1/heartbeats`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List registered machines. */
    async listMachines(query?: { "status"?: string; "limit"?: number; "offset"?: number }, init?: RequestInit): Promise<MachineList> {
      return this.request("GET", `/v1/machines`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Register (upsert) a machine. */
    async registerMachine(body: RegisterMachineRequest, init?: RequestInit): Promise<Machine> {
      return this.request("POST", `/v1/machines`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Fetch one machine by id. */
    async getMachine(id: string, init?: RequestInit): Promise<Machine> {
      return this.request("GET", `/v1/machines/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Deregister a machine. */
    async deleteMachine(id: string, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/machines/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Partially update a machine. */
    async updateMachine(id: string, body: UpdateMachineRequest, init?: RequestInit): Promise<Machine> {
      return this.request("PATCH", `/v1/machines/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Service version and mode (no auth). */
    async version(init?: RequestInit): Promise<HealthResponse> {
      return this.request("GET", `/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
