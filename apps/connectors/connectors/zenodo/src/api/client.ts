import type {
  ConnectorConfig,
  CreateDepositionOptions,
  RecordsSearchOptions,
  RecordsSearchResult,
  UpdateDepositionOptions,
  ZenodoDeposition,
  ZenodoRecord,
} from '../types';
import { ZenodoApiError } from '../types';

const DEFAULT_BASE_URL = 'https://zenodo.org/api';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  requireAuth?: boolean;
}

export class ZenodoClient {
  private readonly accessToken?: string;
  private readonly baseUrl: string;

  constructor(config: ConnectorConfig = {}) {
    this.accessToken = config.accessToken;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private buildHeaders(requireAuth: boolean, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    } else if (requireAuth) {
      throw new ZenodoApiError('Access token required. Set ZENODO_ACCESS_TOKEN or run "connect-zenodo config set-token <token>".');
    }

    return headers;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, requireAuth = false } = options;
    const url = this.buildUrl(path, params);
    const headers = this.buildHeaders(requireAuth, body !== undefined);

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const message =
        typeof parsed === 'object' && parsed !== null && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : `Zenodo API error: ${response.statusText}`;
      throw new ZenodoApiError(message, response.status, parsed);
    }

    return parsed as T;
  }

  async searchRecords(options: RecordsSearchOptions = {}): Promise<RecordsSearchResult> {
    const response = await this.request<{ hits?: { hits?: ZenodoRecord[]; total?: number } }>(
      '/records',
      {
        params: {
          q: options.q,
          type: options.type,
          subtype: options.subtype,
          sort: options.sort,
          page: options.page,
          size: options.size,
          status: options.status,
          communities: options.communities,
        },
      },
    );

    return {
      hits: response.hits?.hits ?? [],
      total: response.hits?.total ?? 0,
    };
  }

  async getRecord(recordId: string | number): Promise<ZenodoRecord> {
    return this.request<ZenodoRecord>(`/records/${recordId}`);
  }

  async listDepositions(): Promise<ZenodoDeposition[]> {
    return this.request<ZenodoDeposition[]>('/deposit/depositions', { requireAuth: true });
  }

  async getDeposition(depositionId: string | number): Promise<ZenodoDeposition> {
    return this.request<ZenodoDeposition>(`/deposit/depositions/${depositionId}`, { requireAuth: true });
  }

  async createDeposition(options: CreateDepositionOptions = {}): Promise<ZenodoDeposition> {
    return this.request<ZenodoDeposition>('/deposit/depositions', {
      method: 'POST',
      body: options.metadata ? { metadata: options.metadata } : {},
      requireAuth: true,
    });
  }

  async updateDeposition(
    depositionId: string | number,
    options: UpdateDepositionOptions,
  ): Promise<ZenodoDeposition> {
    return this.request<ZenodoDeposition>(`/deposit/depositions/${depositionId}`, {
      method: 'PUT',
      body: { metadata: options.metadata },
      requireAuth: true,
    });
  }

  async publishDeposition(depositionId: string | number): Promise<ZenodoDeposition> {
    return this.request<ZenodoDeposition>(`/deposit/depositions/${depositionId}/actions/publish`, {
      method: 'POST',
      requireAuth: true,
    });
  }
}
