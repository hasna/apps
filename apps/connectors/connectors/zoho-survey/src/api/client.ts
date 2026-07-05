import type { ZohoSurveyConfig } from '../types';
import { ZohoSurveyApiError } from '../types';

export const DEFAULT_BASE_URL = 'https://survey.zoho.com/survey/api/v1/private';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | unknown[] | object;
  headers?: Record<string, string>;
}

export class ZohoSurveyClient {
  private readonly token: string;
  private readonly portalId?: string;
  private readonly departmentId?: string;
  private readonly baseUrl: string;

  constructor(config: ZohoSurveyConfig) {
    if (!config.token) {
      throw new Error('Zoho Survey token is required');
    }
    this.token = config.token;
    this.portalId = config.portalId;
    this.departmentId = config.departmentId;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  getPortalId(): string {
    if (!this.portalId) throw new Error('Zoho Survey portalId is required');
    return this.portalId;
  }

  getDepartmentId(): string {
    if (!this.departmentId) throw new Error('Zoho Survey departmentId is required');
    return this.departmentId;
  }

  surveyBasePath(): string {
    return `/portals/${this.getPortalId()}/departments/${this.getDepartmentId()}`;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params, body, headers = {} } = options;
    const url = this.buildUrl(path, params);
    const requestHeaders: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${this.token}`,
      Accept: 'application/json',
      ...headers,
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let data: Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        if (!response.ok) {
          throw new ZohoSurveyApiError(text || response.statusText, response.status);
        }
        return text as T;
      }
    }

    if (!response.ok) {
      const message =
        (typeof data.message === 'string' && data.message) ||
        (typeof data.errormessage === 'string' && data.errormessage) ||
        (typeof data.error === 'string' && data.error) ||
        response.statusText;
      throw new ZohoSurveyApiError(message, response.status, data.code as string | number | undefined);
    }

    return data as T;
  }
}
