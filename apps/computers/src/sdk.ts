import { ComputersError, type AdoptComputerInput, type ApiErrorBody, type Computer, type ComputerCreateGrant, type ComputerProfile, type CreateComputerGrantInput, type CreateComputerInput, type CreateComputerProfileInput, type ErrorCode, type ExecRequest, type InstallPlan, type InstallPolicyRevision, type InstallPolicyRule, type Operation, type PackageSpec, type ProviderReadiness } from "./contracts";

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
const MAX_SDK_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const ERROR_CODES_BY_STATUS = new Map<number, ReadonlySet<ErrorCode>>([
  [400, new Set(["invalid_request"])],
  [401, new Set(["authentication_required"])],
  [403, new Set(["authorization_denied", "policy_generation_mismatch"])],
  [404, new Set(["not_found"])],
  [409, new Set(["conflict", "replay_detected", "stale_fence", "expired", "policy_generation_mismatch", "quota_exceeded"])],
  [413, new Set(["request_too_large"])],
  [500, new Set(["storage_error"])],
  [501, new Set(["unsupported_operation", "sandbox_disabled"])],
  [502, new Set(["storage_error"])],
  [503, new Set(["provider_not_configured", "provider_outcome_unknown"])],
]);

async function boundedResponseText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_SDK_RESPONSE_BYTES)) {
    await response.body?.cancel(); throw new ComputersError("storage_error", "Response body is too large", 502);
  }
  if (response.body === null) return "";
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_SDK_RESPONSE_BYTES) { await reader.cancel(); throw new ComputersError("storage_error", "Response body is too large", 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function safeApiError(value: unknown, status: number): { code: ErrorCode; message: string; requestId: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const envelope = value as Record<string, unknown>;
  if (!exactKeys(envelope, ["error"])) return undefined;
  const error = envelope.error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return undefined;
  const candidate = error as Record<string, unknown>;
  if (!exactKeys(candidate, ["code", "message", "requestId"])) return undefined;
  if (typeof candidate.code !== "string" || !ERROR_CODES.has(candidate.code as ErrorCode)
    || !ERROR_CODES_BY_STATUS.get(status)?.has(candidate.code as ErrorCode)
    || typeof candidate.message !== "string" || candidate.message.length < 1 || candidate.message.length > 512
    || typeof candidate.requestId !== "string" || !REQUEST_ID.test(candidate.requestId)) return undefined;
  return { code: candidate.code as ErrorCode, message: candidate.message, requestId: candidate.requestId };
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
  async adoptComputer(input: AdoptComputerInput): Promise<Computer> { return this.request("POST", "/v1/computers/adopt", input, input.idempotencyKey); }
  async listProfiles(): Promise<ComputerProfile[]> { return (await this.request<{ data: ComputerProfile[] }>("GET", "/v1/profiles")).data; }
  async createProfile(input: CreateComputerProfileInput): Promise<ComputerProfile> { return this.request("POST", "/v1/profiles", input); }
  async listComputerGrants(): Promise<ComputerCreateGrant[]> { return (await this.request<{ data: ComputerCreateGrant[] }>("GET", "/v1/computer-create-grants")).data; }
  async createComputerGrant(input: CreateComputerGrantInput): Promise<ComputerCreateGrant> { return this.request("POST", "/v1/computer-create-grants", input); }
  async requestLifecycle(id: string, action: "start" | "stop" | "quarantine" | "delete", idempotencyKey: string): Promise<Operation> {
    return this.request("POST", `/v1/computers/${encodeURIComponent(id)}/${action}`, { idempotencyKey }, idempotencyKey);
  }
  async requestExec(id: string, input: ExecRequest): Promise<Operation> { return this.request("POST", `/v1/computers/${encodeURIComponent(id)}/exec`, input, input.idempotencyKey); }
  async installPlan(id: string, spec: PackageSpec): Promise<InstallPlan & { ticket?: string }> { return this.request("POST", `/v1/computers/${encodeURIComponent(id)}/install/plan`, { spec }); }
  async installApply(id: string, ticket: string, idempotencyKey: string): Promise<Operation> { return this.request("POST", `/v1/computers/${encodeURIComponent(id)}/install/apply`, { ticket, idempotencyKey }, idempotencyKey); }
  async getInstallPolicy(id: string): Promise<InstallPolicyRevision> { return this.request("GET", `/v1/computers/${encodeURIComponent(id)}/install/policy`); }
  async createInstallPolicy(id: string, rules: InstallPolicyRule[]): Promise<InstallPolicyRevision> {
    return this.request("POST", `/v1/computers/${encodeURIComponent(id)}/install/policy`, { rules });
  }
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
    const mediaType = contentType.split(";", 1)[0]!.trim().toLowerCase();
    let parsed: T | ApiErrorBody | undefined;
    if (mediaType === "application/json") {
      const text = await boundedResponseText(response);
      try { parsed = JSON.parse(text) as T | ApiErrorBody; } catch { parsed = undefined; }
    } else {
      await response.body?.cancel();
    }
    if (!response.ok) {
      const error = safeApiError(parsed, response.status);
      if (error === undefined) throw new ComputersError("storage_error", "Request failed", 502);
      throw new ComputersError(error.code, error.message, response.status, { requestId: error.requestId });
    }
    if (parsed === undefined) throw new ComputersError("storage_error", "Invalid JSON response", 502);
    return parsed as T;
  }
}
