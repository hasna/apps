import type { DockerConfig, OutputFormat } from '../types';
import { DockerApiError } from '../types';

// Docker Hub API base URL
const DEFAULT_BASE_URL = 'https://hub.docker.com/v2';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | string;
  headers?: Record<string, string>;
  format?: OutputFormat;
}

export class DockerClient {
  private readonly username?: string;
  private readonly password?: string;
  private readonly accessToken?: string;
  private readonly baseUrl: string;
  private jwtToken?: string;

  constructor(config: DockerConfig) {
    if (!config.accessToken && (!config.username || !config.password)) {
      throw new Error('Either access token or username/password is required');
    }
    this.username = config.username;
    this.password = config.password;
    this.accessToken = config.accessToken;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  /**
   * Login to Docker Hub and get JWT token
   */
  async login(): Promise<string> {
    if (this.accessToken) {
      this.jwtToken = this.accessToken;
      return this.jwtToken;
    }

    const response = await fetch(`${this.baseUrl}/users/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new DockerApiError(`Login failed: ${text}`, response.status);
    }

    const data = await response.json() as { token: string };
    this.jwtToken = data.token;
    return this.jwtToken;
  }

  /**
   * Ensure we have a valid JWT token
   */
  private async ensureAuth(): Promise<string> {
    if (!this.jwtToken) {
      await this.login();
    }
    return this.jwtToken!;
  }

  /**
   * Make an authenticated request to Docker Hub API
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;

    const url = this.buildUrl(path, params);
    const token = await this.ensureAuth();

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // Parse response
    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
    } else {
      data = await response.text();
    }

    // Handle errors
    if (!response.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? JSON.stringify(data)
        : String(data || response.statusText);
      throw new DockerApiError(errorMessage, response.status);
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'GET', params });
  }

  async post<T>(path: string, body?: Record<string, unknown> | unknown[] | string | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: body as Record<string, unknown>, params });
  }

  async put<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: body as Record<string, unknown>, params });
  }

  async patch<T>(path: string, body?: Record<string, unknown> | object, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: body as Record<string, unknown>, params });
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE', params });
  }

  /**
   * Get a preview of the credentials (for display/debugging)
   */
  getCredentialsPreview(): string {
    if (this.accessToken) {
      if (this.accessToken.length > 10) {
        return `Token: ${this.accessToken.substring(0, 6)}...${this.accessToken.substring(this.accessToken.length - 4)}`;
      }
      return 'Token: ***';
    }
    return `User: ${this.username || 'not set'}`;
  }
}
