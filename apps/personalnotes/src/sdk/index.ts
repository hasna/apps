import type { AuthResult } from "../lib/auth/service.js";
import type { PublicUser, Tenant } from "../lib/tenancy/types.js";

/**
 * Minimal HTTP client the desktop app and CLI use to authenticate against a
 * running multi-tenancy backend (`personalnotes-serve`). Holds a bearer token,
 * never a database DSN (hasna-storage-standard: clients flip to HTTP).
 */
export interface AuthClientOptions {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export interface MeResponse {
  tenantId: string;
  userId: string;
  email: string;
  role: string;
  isSuperAdmin: boolean;
  tokenKind: string;
}

export class PersonalNotesAuthClient {
  private token: string | undefined;
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(options: AuthClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.doFetch = options.fetch ?? fetch;
  }

  getToken(): string | undefined {
    return this.token;
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    if (!res.ok) {
      const err = parsed as { error?: string; message?: string };
      throw new Error(`${err.error ?? res.status}: ${err.message ?? res.statusText}`);
    }
    return parsed as T;
  }

  async register(input: { email: string; password: string; displayName?: string; tenantName?: string }): Promise<AuthResult> {
    const result = await this.request<AuthResult>("POST", "/v1/auth/register", input);
    this.token = result.token;
    return result;
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const result = await this.request<AuthResult>("POST", "/v1/auth/login", { email, password });
    this.token = result.token;
    return result;
  }

  async me(): Promise<MeResponse> {
    return this.request<MeResponse>("GET", "/v1/auth/me");
  }

  async logout(): Promise<void> {
    await this.request<{ ok: boolean }>("POST", "/v1/auth/logout");
    this.token = undefined;
  }

  async createApiToken(label?: string): Promise<AuthResult> {
    return this.request<AuthResult>("POST", "/v1/auth/tokens", { label });
  }

  async listTenantUsers(tenantId?: string): Promise<{ users: PublicUser[] }> {
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    return this.request<{ users: PublicUser[] }>("GET", `/v1/tenant/users${qs}`);
  }

  /** Super-admin only. */
  async listAllTenants(): Promise<{ tenants: Tenant[] }> {
    return this.request<{ tenants: Tenant[] }>("GET", "/v1/admin/tenants");
  }
}
