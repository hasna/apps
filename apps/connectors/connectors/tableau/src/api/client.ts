import type { TableauConfig, SignInResponse, SignInState } from '../types';
import { TableauApiError } from '../types';

const DEFAULT_API_VERSION = '3.21';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

// Tableau uses a session sign-in flow rather than a static bearer token:
//   POST {serverUrl}/api/{apiVersion}/auth/signin  -> { token, siteId }
// Subsequent requests carry the X-Tableau-Auth header and are scoped under
//   /api/{apiVersion}/sites/{siteId}/...
// The client signs in lazily on the first call and caches the session.
export class TableauClient {
  private readonly serverUrl: string;
  private readonly apiVersion: string;
  private readonly siteName: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly patName?: string;
  private readonly patSecret?: string;

  private session: SignInState | null = null;
  private signInPromise: Promise<SignInState> | null = null;

  constructor(config: TableauConfig) {
    if (!config.serverUrl) {
      throw new Error('serverUrl is required');
    }

    const hasPat = Boolean(config.patName && config.patSecret);
    const hasUserPass = Boolean(config.username && config.password);
    if (!hasPat && !hasUserPass) {
      throw new Error(
        'Credentials are required: provide either a personal access token (patName + patSecret) or username + password',
      );
    }

    this.serverUrl = config.serverUrl.replace(/\/+$/, '');
    this.apiVersion = config.apiVersion || DEFAULT_API_VERSION;
    this.siteName = config.siteName ?? '';
    this.username = config.username;
    this.password = config.password;
    this.patName = config.patName;
    this.patSecret = config.patSecret;
  }

  getApiVersion(): string {
    return this.apiVersion;
  }

  private buildSignInBody(): Record<string, unknown> {
    const credentials: Record<string, unknown> = {
      site: { contentUrl: this.siteName },
    };

    if (this.patName && this.patSecret) {
      credentials.personalAccessTokenName = this.patName;
      credentials.personalAccessTokenSecret = this.patSecret;
    } else {
      credentials.name = this.username;
      credentials.password = this.password;
    }

    return { credentials };
  }

  private async performSignIn(): Promise<SignInState> {
    const url = `${this.serverUrl}/api/${this.apiVersion}/auth/signin`;
    const response = await this.rawFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(this.buildSignInBody()),
    });

    const data = await this.parseResponse(response);

    if (!response.ok) {
      throw this.toApiError(data, response);
    }

    const signIn = data as SignInResponse;
    const creds = signIn?.credentials;
    if (!creds?.token || !creds?.site?.id) {
      throw new TableauApiError('Sign-in succeeded but no session token was returned', response.status);
    }

    return {
      token: creds.token,
      siteId: creds.site.id,
      userId: creds.user?.id ?? '',
    };
  }

  private async ensureSession(): Promise<SignInState> {
    if (this.session) {
      return this.session;
    }
    if (!this.signInPromise) {
      this.signInPromise = this.performSignIn()
        .then((session) => {
          this.session = session;
          return session;
        })
        .finally(() => {
          this.signInPromise = null;
        });
    }
    return this.signInPromise;
  }

  /** Force a fresh sign-in on the next request (e.g. after a 401). */
  invalidateSession(): void {
    this.session = null;
  }

  private buildUrl(path: string, siteId: string, params?: RequestOptions['params']): string {
    const base = `${this.serverUrl}/api/${this.apiVersion}/sites/${siteId}`;
    const url = new URL(`${base}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  private async rawFetch(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseResponse(response: Response): Promise<unknown> {
    if (response.status === 204) {
      return {};
    }
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    if (!text) {
      return {};
    }
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }

  private toApiError(data: unknown, response: Response): TableauApiError {
    const err = (data as { error?: { summary?: string; detail?: string; code?: string } })?.error;
    const message = err?.summary
      ? `${err.summary}${err.detail ? `: ${err.detail}` : ''}`
      : typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
    return new TableauApiError(message, response.status, err?.code, err?.detail);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = 'GET',
      params,
      body,
      headers = {},
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxRetries = DEFAULT_MAX_RETRIES,
    } = options;

    let attempt = 0;
    let retriedAuth = false;

    while (true) {
      const session = await this.ensureSession();
      const url = this.buildUrl(path, session.siteId, params);

      const requestHeaders: Record<string, string> = {
        'X-Tableau-Auth': session.token,
        'Accept': 'application/json',
        ...headers,
      };

      const fetchOptions: RequestInit = { method, headers: requestHeaders };
      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        requestHeaders['Content-Type'] = 'application/json';
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      let response: Response;
      try {
        response = await this.rawFetch(url, fetchOptions, timeoutMs);
      } catch (err) {
        // Network/timeout errors are retried with a small backoff.
        if (attempt < maxRetries) {
          attempt++;
          await this.delay(attempt);
          continue;
        }
        throw err instanceof Error ? err : new Error(String(err));
      }

      // Expired/invalid session: sign in again once.
      if (response.status === 401 && !retriedAuth) {
        retriedAuth = true;
        this.invalidateSession();
        continue;
      }

      // Retry transient server errors.
      if ((response.status >= 500 || response.status === 429) && attempt < maxRetries) {
        attempt++;
        await this.delay(attempt);
        continue;
      }

      const data = await this.parseResponse(response);
      if (!response.ok) {
        throw this.toApiError(data, response);
      }
      return data as T;
    }
  }

  private delay(attempt: number): Promise<void> {
    const ms = Math.min(1000 * attempt, 4000);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async get<T>(path: string, params?: RequestOptions['params']): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: RequestOptions['body'], params?: RequestOptions['params']): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, params });
  }

  getServerUrlPreview(): string {
    return this.serverUrl;
  }
}
