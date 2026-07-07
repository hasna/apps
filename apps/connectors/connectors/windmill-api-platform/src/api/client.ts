import {
  WindmillApiPlatformApiError,
  type WindmillApiPlatformConfig,
  type QueryParams,
  type RawRequestOptions,
  type RunScriptOptions,
} from '../types';

export const DEFAULT_BASE_URL: string | undefined = undefined;

export class WindmillApiPlatformClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly workspace: string;

  constructor(config: WindmillApiPlatformConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    if (!baseUrl) {
      throw new Error('Windmill API Platform baseUrl is required');
    }
    if (!config.workspace) {
      throw new Error('Windmill API Platform workspace is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.workspace = config.workspace;
  }

  buildUrl(path: string, query?: QueryParams): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private workspacePath(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `/w/${encodeURIComponent(this.workspace)}${normalizedPath}`;
  }

  private pathParam(path: string): string {
    return encodeURIComponent(path);
  }

  private async request<T>(
    path: string,
    options: RequestInit & { query?: QueryParams } = {}
  ): Promise<T> {
    const { query, ...fetchOptions } = options;
    const url = this.buildUrl(path, query);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      ...(fetchOptions.headers as Record<string, string> | undefined),
    };

    const method = (fetchOptions.method || 'GET').toUpperCase();
    if (fetchOptions.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const response = await fetch(url, {
      ...fetchOptions,
      method,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = errorText;
      try {
        const errorJson = JSON.parse(errorText) as { error?: string; message?: string; detail?: string };
        message = errorJson.detail || errorJson.error || errorJson.message || errorText;
      } catch {
        // Use raw text
      }
      throw new WindmillApiPlatformApiError(message, response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return text as T;
    }

    return JSON.parse(text) as T;
  }

  async listScripts(query?: QueryParams): Promise<unknown> {
    return this.request(this.workspacePath('/scripts/list'), { query });
  }

  async getScript(path: string): Promise<unknown> {
    return this.request(this.workspacePath(`/scripts/get/p/${this.pathParam(path)}`));
  }

  async runScript(options: RunScriptOptions): Promise<unknown> {
    return this.request(this.workspacePath(`/jobs/run/p/${this.pathParam(options.path)}`), {
      method: 'POST',
      query: options.query,
      body: JSON.stringify(options.args ?? {}),
    });
  }

  async runScriptAndWait(options: RunScriptOptions): Promise<unknown> {
    return this.request(this.workspacePath(`/jobs/run_wait_result/p/${this.pathParam(options.path)}`), {
      method: 'POST',
      query: options.query,
      body: JSON.stringify(options.args ?? {}),
    });
  }

  async listFlows(query?: QueryParams): Promise<unknown> {
    return this.request(this.workspacePath('/flows/list'), { query });
  }

  async getFlow(path: string): Promise<unknown> {
    return this.request(this.workspacePath(`/flows/get/${this.pathParam(path)}`));
  }

  async listResources(query?: QueryParams): Promise<unknown> {
    return this.request(this.workspacePath('/resources/list'), { query });
  }

  async getResource(path: string): Promise<unknown> {
    return this.request(this.workspacePath(`/resources/get/${this.pathParam(path)}`));
  }

  async listJobs(query?: QueryParams): Promise<unknown> {
    return this.request(this.workspacePath('/jobs/list'), { query });
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const method = (options.method || 'GET').toUpperCase();
    const path = options.path.startsWith('/') ? options.path : `/${options.path}`;
    const init: RequestInit & { query?: QueryParams } = {
      method,
      query: options.query,
      headers: options.headers,
    };

    if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    return this.request(path, init);
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
