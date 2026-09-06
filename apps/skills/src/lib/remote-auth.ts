import { RemoteSkillsClient } from "./remote-client.js";
import { normalizeSkillsApiOrigin } from "./fleet-credentials.js";
import { customerNamePatch, type UpdateRemoteProfile, type UpdateRemoteWorkspace } from "./remote-profile.js";

const MAX_ERROR_DETAIL_LENGTH = 200;
export class HostedApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
  readonly endpoint?: string;
  readonly apiUrl?: string;

  constructor(
    message: string,
    options: { status?: number; code?: string; detail?: string; endpoint?: string; apiUrl?: string } = {},
  ) {
    super(message);
    this.name = "HostedApiError";
    this.status = options.status;
    this.code = options.code;
    this.detail = options.detail;
    this.endpoint = options.endpoint;
    this.apiUrl = options.apiUrl;
  }
}


async function requestAuthApi(instance: string, path: string, options?: RequestInit) {
  // Throws MissingApiUrlError when nothing is configured. Credentials are never
  // sent to a default host, so the command fails before any request is made.
  const url = normalizeSkillsApiOrigin(instance);
  const safeUrl = url;
  const endpoint = `${(options?.method || "GET").toUpperCase()} ${safeUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      ...options,
      redirect: "error",
      signal: options?.signal ?? AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch (err) {
    throw new HostedApiError(`Unable to reach the Skills API: ${(err as Error).message}`, {
      endpoint,
      apiUrl: safeUrl,
    });
  }

  const text = await res.text();
  const body = text ? parseJsonBody(text) : {};
  if (!res.ok) {
    const record = isRecord(body) ? body : {};
    const detail = typeof record.detail === "string" ? record.detail : undefined;
    const error = typeof record.error === "string" ? record.error : undefined;
    const code = typeof record.code === "string" ? record.code : undefined;
    throw new HostedApiError(detail || error || `${res.status} ${res.statusText}`, {
      status: res.status,
      code,
      detail,
      endpoint,
      apiUrl: safeUrl,
    });
  }

  return body as any;
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: condenseErrorBody(text) };
  }
}

// Error bodies are frequently HTML pages from a proxy/CDN rather than API JSON.
// Dumping the raw page hides the real message, so keep a short single-line summary.
function condenseErrorBody(text: string): string {
  const stripped = /<[a-z!/]/i.test(text)
    ? text
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]*>/g, " ")
    : text;
  const collapsed = stripped.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_ERROR_DETAIL_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_ERROR_DETAIL_LENGTH - 1).trimEnd()}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Passwordless auth transport for an explicitly selected instance. It never writes credentials. */
export class RemoteSkillsAuthClient {
  readonly apiOrigin: string;
  constructor(apiUrl: string) { this.apiOrigin = normalizeSkillsApiOrigin(apiUrl); }
  requestCode(email: string) { return this.request("/api/auth/login", { method: "POST", body: JSON.stringify({ email }) }); }
  verifyCode(email: string, code: string) { return this.request("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, code }) }); }
  startDevice() { return this.request("/api/auth/device/start", { method: "POST", body: JSON.stringify({ client: "skills-sdk" }) }); }
  pollDevice(deviceCode: string) { return this.request("/api/auth/device/token", { method: "POST", body: JSON.stringify({ deviceCode }) }); }
  private async sessionClient(email: string, code: string): Promise<RemoteSkillsClient> {
    if (!email.includes("@") || !/^\d{6}$/.test(code)) throw new Error("Fresh email and six-digit verification code are required to manage this account");
    const login = await this.verifyCode(email, code);
    if (!login || typeof login.token !== "string" || !login.token) throw new Error("The server did not return an authorized account session");
    return new RemoteSkillsClient(login.token, this.apiOrigin);
  }
  async createApiKey(email: string, code: string, name: string, scopes?: string[]) {
    return (await this.sessionClient(email, code)).createApiKey(name, scopes);
  }
  async listApiKeys(email: string, code: string) { return (await this.sessionClient(email, code)).listApiKeys(); }
  async revokeApiKey(email: string, code: string, keyId: string) { return (await this.sessionClient(email, code)).revokeApiKey(keyId); }
  /** Reauthentication is ephemeral: it never replaces a saved key or profile. */
  async updateProfile(email: string, code: string, input: UpdateRemoteProfile) {
    customerNamePatch(input, "displayName");
    return (await this.sessionClient(email, code)).updateProfile(input);
  }
  async updateCurrentWorkspace(email: string, code: string, input: UpdateRemoteWorkspace) {
    customerNamePatch(input, "name");
    return (await this.sessionClient(email, code)).updateCurrentWorkspace(input);
  }
  /** Common auth transport used by CLI login, preserving the selected instance through awaits. */
  request(path: string, options?: RequestInit) {
    if (!["/api/auth/login", "/api/auth/verify", "/api/auth/device/start", "/api/auth/device/token", "/api/auth/keys", "/api/auth/whoami"].includes(path)) throw new Error("Unsupported authentication operation");
    return requestAuthApi(this.apiOrigin, path, options);
  }
}
