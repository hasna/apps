/**
 * Typed /v1 API client for @hasnaxyz/sandboxes. This is the SDK surface: a thin,
 * fetch-based, bearer-authed client. It NEVER touches a database, a provider
 * SDK, or a local file — clients only ever talk to the self-hosted API
 * (https://sandboxes.hasna.xyz/v1) with an API key (CLAUDE.md §2).
 */
import type { SandboxSpecV1 } from "./types.js";

export type AdapterId = "fake" | "e2b" | "daytona_cloud";
export type AllocationState =
  | "requested"
  | "provisioning"
  | "active"
  | "expired"
  | "failed"
  | "destroyed";

export interface Allocation {
  allocation_id: string;
  tenant_id: string;
  resource_id: string | null;
  adapter_id: AdapterId;
  state: AllocationState;
  spec_sha256: string;
  spec: unknown;
  requested_by_user_id: string | null;
  state_reason: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  destroyed_at: string | null;
}

export interface Checkpoint {
  checkpoint_id: string;
  tenant_id: string;
  allocation_id: string;
  s3_key: string | null;
  size_bytes: number;
  sha256: string;
  label: string | null;
  created_at: string;
}

export interface WhoAmI {
  tenant_id: string;
  user_id: string | null;
  principal_type: "user" | "service";
  scopes: string[];
  via: string;
}

export interface SandboxesClientOptions {
  /** Base URL, e.g. https://sandboxes.hasna.xyz (with or without /v1). */
  apiUrl?: string;
  /** Bearer API key. */
  apiKey?: string;
  /** Custom fetch (tests). */
  fetch?: typeof fetch;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  operation: string;
  request_id: string;
  data?: T;
  error?: { code: string; message: string; details: Record<string, string | number | boolean> };
}

export class SandboxesApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, string | number | boolean>;
  constructor(status: number, code: string, message: string, details: Record<string, string | number | boolean> = {}) {
    super(message);
    this.name = "SandboxesApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function resolveApiUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

export class SandboxesClient {
  private readonly base: string;
  private readonly apiKey: string | undefined;
  private readonly doFetch: typeof fetch;

  constructor(options: SandboxesClientOptions = {}) {
    const url = options.apiUrl ?? process.env["HASNA_SANDBOXES_API_URL"] ?? "http://127.0.0.1:8080";
    this.base = resolveApiUrl(url);
    this.apiKey = options.apiKey ?? process.env["HASNA_SANDBOXES_API_KEY"] ?? undefined;
    this.doFetch = options.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.doFetch(`${this.base}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let envelope: ApiEnvelope<T>;
    try {
      envelope = (await res.json()) as ApiEnvelope<T>;
    } catch {
      throw new SandboxesApiError(res.status, "internal_failure", `Non-JSON response (${res.status})`);
    }
    if (!res.ok || !envelope.ok) {
      const err = envelope.error;
      throw new SandboxesApiError(res.status, err?.code ?? "internal_failure", err?.message ?? "Request failed", err?.details ?? {});
    }
    return envelope.data as T;
  }

  /** Public health (no auth). */
  health(): Promise<{ status: string; name: string; version: string; mode: string }> {
    return this.request("GET", "/health");
  }

  version(): Promise<{ name: string; version: string }> {
    return this.request("GET", "/version");
  }

  whoami(): Promise<WhoAmI> {
    return this.request("GET", "/v1/whoami");
  }

  v1Health(): Promise<{ status: string; backend: string; tenant_id: string }> {
    return this.request("GET", "/v1/health");
  }

  validate(kind: string, document: unknown): Promise<{ valid: boolean; document_sha256: string }> {
    return this.request("POST", `/v1/validate/${kind}`, { document });
  }

  listAdapters(): Promise<{ adapters: unknown[]; live_adapters: string[]; note: string }> {
    return this.request("GET", "/v1/adapters");
  }

  allocate(input: { adapter: AdapterId; spec: SandboxSpecV1 }): Promise<{ allocation: Allocation }> {
    return this.request("POST", "/v1/sandboxes", input);
  }

  listSandboxes(opts?: { state?: AllocationState; limit?: number }): Promise<{ allocations: Allocation[]; count: number }> {
    const params = new URLSearchParams();
    if (opts?.state) params.set("state", opts.state);
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.request("GET", `/v1/sandboxes${qs ? `?${qs}` : ""}`);
  }

  getSandbox(allocationId: string): Promise<{ allocation: Allocation }> {
    return this.request("GET", `/v1/sandboxes/${encodeURIComponent(allocationId)}`);
  }

  destroySandbox(allocationId: string): Promise<{ allocation: Allocation }> {
    return this.request("POST", `/v1/sandboxes/${encodeURIComponent(allocationId)}/destroy`);
  }

  createCheckpoint(
    allocationId: string,
    input?: { label?: string; payload_base64?: string },
  ): Promise<{ checkpoint: Checkpoint }> {
    return this.request("POST", `/v1/sandboxes/${encodeURIComponent(allocationId)}/checkpoints`, input ?? {});
  }

  listCheckpoints(allocationId: string): Promise<{ checkpoints: Checkpoint[]; count: number }> {
    return this.request("GET", `/v1/sandboxes/${encodeURIComponent(allocationId)}/checkpoints`);
  }

  getCheckpoint(checkpointId: string): Promise<{ checkpoint: Checkpoint }> {
    return this.request("GET", `/v1/checkpoints/${encodeURIComponent(checkpointId)}`);
  }

  // --- admin ---
  createTenant(input: { tenant_id?: string; slug?: string; name?: string; kind?: string }): Promise<{ tenant: unknown }> {
    return this.request("POST", "/v1/admin/tenants", input);
  }

  setQuota(input: {
    tenant_id?: string;
    adapter: AdapterId;
    max_concurrent: number;
    max_monthly_alloc?: number;
    max_monthly_cost_micros?: number;
  }): Promise<{ quota: unknown }> {
    return this.request("POST", "/v1/admin/quota", input);
  }

  mintApiKey(input: {
    tenant_id?: string;
    user_id?: string;
    principal_type?: "user" | "service";
    scopes?: string[];
  }): Promise<{ kid: string; api_key: string; tenant_id: string; scopes: string[] }> {
    return this.request("POST", "/v1/admin/api-keys", input);
  }

  revokeApiKey(kid: string): Promise<{ kid: string; revoked: boolean }> {
    return this.request("POST", `/v1/admin/api-keys/${encodeURIComponent(kid)}/revoke`);
  }
}

export default SandboxesClient;
