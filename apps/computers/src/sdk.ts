import { ComputersError, type ApiErrorBody, type Computer, type ComputerCreateGrant, type CreateComputerGrantInput, type CreateComputerInput, type ErrorCode, type ExecRequest, type InstallPlan, type Operation, type PackageSpec, type ProviderReadiness } from "./contracts";

export interface CredentialProvider {
  getBearerToken(): Promise<string>;
}

export class StaticCredentialProvider implements CredentialProvider {
  readonly #credential: string;
  constructor(credential: string) { this.#credential = validateClientToken(credential); }
  async getBearerToken(): Promise<string> { return this.#credential; }
}

export class EnvironmentCredentialProvider implements CredentialProvider {
  readonly #name: string;
  constructor(name = "COMPUTERS_TOKEN") { this.#name = name; }
  async getBearerToken(): Promise<string> {
    const authValue = Bun.env[this.#name];
    return validateClientToken(authValue);
  }
}

export interface ComputersClientOptions {
  baseUrl: string;
  credentials: CredentialProvider;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

function validateClientToken(authValue: unknown): string {
  if (typeof authValue !== "string" || authValue.length < 16 || authValue.length > 512 || /[\r\n]/.test(authValue)) {
    throw new ComputersError("authentication_required", "Authentication configuration is required", 401);
  }
  return authValue;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ComputersError("invalid_request", "Invalid Computers API URL", 400); }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password
    || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) throw new ComputersError("invalid_request", "Invalid Computers API URL", 400);
  return url.origin;
}

const ERROR_CODES = new Set<ErrorCode>([
  "authentication_required", "authorization_denied", "not_found", "conflict", "invalid_request", "request_too_large",
  "provider_not_configured", "provider_outcome_unknown", "unsupported_operation", "sandbox_disabled", "replay_detected",
  "stale_fence", "expired", "policy_generation_mismatch", "quota_exceeded", "storage_error",
]);

function safeApiError(value: unknown): { code: ErrorCode; message: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return undefined;
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code !== "string" || !ERROR_CODES.has(candidate.code as ErrorCode)
    || typeof candidate.message !== "string" || candidate.message.length < 1 || candidate.message.length > 512) return undefined;
  return { code: candidate.code as ErrorCode, message: candidate.message };
}

export class ComputersClient {
  readonly #baseUrl: string;
  readonly #credentials: CredentialProvider;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;

  constructor(options: ComputersClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#credentials = options.credentials;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 100 || this.#timeoutMs > 60_000) throw new ComputersError("invalid_request", "Invalid SDK timeout", 400);
  }

  async listComputers(): Promise<Computer[]> { return (await this.request<{ data: Computer[] }>("GET", "/v1/computers")).data; }
  async getComputer(id: string): Promise<Computer> { return this.request("GET", `/v1/computers/${encodeURIComponent(id)}`); }
  async createComputer(input: CreateComputerInput): Promise<Computer> { return this.request("POST", "/v1/computers", input, input.idempotencyKey); }
  async listComputerGrants(): Promise<ComputerCreateGrant[]> { return (await this.request<{ data: ComputerCreateGrant[] }>("GET", "/v1/computer-create-grants")).data; }
  async createComputerGrant(input: CreateComputerGrantInput): Promise<ComputerCreateGrant> { return this.request("POST", "/v1/computer-create-grants", input); }
  async requestLifecycle(id: string, action: "start" | "stop" | "quarantine" | "delete", idempotencyKey: string): Promise<Operation> {
    return this.request("POST", `/v1/computers/${encodeURIComponent(id)}/${action}`, { idempotencyKey }, idempotencyKey);
  }
  async requestExec(id: string, input: ExecRequest): Promise<Operation> { return this.request("POST", `/v1/computers/${encodeURIComponent(id)}/exec`, input, input.idempotencyKey); }
  async installPlan(id: string, spec: PackageSpec): Promise<InstallPlan & { ticket?: string }> { return this.request("POST", `/v1/computers/${encodeURIComponent(id)}/install/plan`, { spec }); }
  async installApply(id: string, ticket: string, idempotencyKey: string): Promise<Operation> { return this.request("POST", `/v1/computers/${encodeURIComponent(id)}/install/apply`, { ticket, idempotencyKey }, idempotencyKey); }
  async listOperations(computerId?: string): Promise<Operation[]> {
    const query = computerId === undefined ? "" : `?computerId=${encodeURIComponent(computerId)}`;
    return (await this.request<{ data: Operation[] }>("GET", `/v1/operations${query}`)).data;
  }
  async providerReadiness(): Promise<ProviderReadiness[]> { return (await this.request<{ data: ProviderReadiness[] }>("GET", "/v1/providers/readiness")).data; }

  private async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const bearerValue = validateClientToken(await this.#credentials.getBearerToken());
    const headers: Record<string, string> = { authorization: `Bearer ${bearerValue}`, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey !== undefined) headers["idempotency-key"] = idempotencyKey;
    const init: RequestInit = { method, headers, redirect: "manual", signal: AbortSignal.timeout(this.#timeoutMs) };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await this.#fetch(`${this.#baseUrl}${path}`, init);
    if (response.status >= 300 && response.status < 400) throw new ComputersError("storage_error", "Cross-origin redirect rejected", 502);
    const contentType = response.headers.get("content-type") ?? "";
    let parsed: T | ApiErrorBody | undefined;
    if (contentType.toLowerCase().includes("application/json")) {
      try { parsed = await response.json() as T | ApiErrorBody; } catch { parsed = undefined; }
    } else {
      await response.body?.cancel();
    }
    if (!response.ok) {
      const error = safeApiError(parsed);
      throw new ComputersError(error?.code ?? "storage_error", error?.message ?? "Request failed", response.status);
    }
    if (parsed === undefined) throw new ComputersError("storage_error", "Invalid JSON response", 502);
    return parsed as T;
  }
}
