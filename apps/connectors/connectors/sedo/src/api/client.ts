import { XMLParser } from 'fast-xml-parser';
import type { SedoConfig } from '../types';
import { SedoApiError } from '../types';

const DEFAULT_BASE_URL = 'https://api.sedo.com/api/v1';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, string | number | boolean | string[] | undefined>;
}

export class SedoClient {
  private readonly partnerId: string;
  private readonly signKey: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly baseUrl: string;
  private readonly parser: XMLParser;

  constructor(config: SedoConfig) {
    if (!config.partnerId) {
      throw new Error('Partner ID is required');
    }
    if (!config.signKey) {
      throw new Error('Sign key (API key) is required');
    }
    this.partnerId = config.partnerId;
    this.signKey = config.signKey;
    this.username = config.username;
    this.password = config.password;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;

    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      isArray: (name) => ['item', 'domain', 'category'].includes(name),
    });
  }

  private buildUrl(endpoint: string, params?: Record<string, string | number | boolean | string[] | undefined>): string {
    const url = new URL(`${this.baseUrl}/${endpoint}`);

    // Add auth params
    url.searchParams.append('partnerid', this.partnerId);
    url.searchParams.append('signkey', this.signKey);

    // Add username/password if available
    if (this.username) {
      url.searchParams.append('username', this.username);
    }
    if (this.password) {
      url.searchParams.append('password', this.password);
    }

    // Add output format
    url.searchParams.append('output_method', 'xml');

    // Add other params
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value)) {
            value.forEach((v, i) => {
              url.searchParams.append(`${key}[${i}]`, String(v));
            });
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      });
    }

    return url.toString();
  }

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', params } = options;
    const url = this.buildUrl(endpoint, params);

    const response = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/xml',
      },
    });

    const text = await response.text();

    // Parse XML response
    const data = this.parser.parse(text);

    // Check for fault response
    if (data.SEDOFAULT) {
      const fault = data.SEDOFAULT;
      // Handle cases where faultstring/faultcode might be objects from XML parser
      let faultString: string;
      let faultCode: string;

      if (typeof fault.faultstring === 'string') {
        faultString = fault.faultstring;
      } else if (fault.faultstring?.['#text']) {
        faultString = fault.faultstring['#text'];
      } else {
        faultString = 'Unknown error';
      }

      if (typeof fault.faultcode === 'string') {
        faultCode = fault.faultcode;
      } else if (fault.faultcode?.['#text']) {
        faultCode = fault.faultcode['#text'];
      } else {
        faultCode = 'API_ERROR';
      }

      throw new SedoApiError(faultString, faultCode, response.status);
    }

    return data as T;
  }

  async get<T>(endpoint: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', params });
  }

  async post<T>(endpoint: string, params?: Record<string, string | number | boolean | string[] | undefined>): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', params });
  }

  // Get partner ID for display
  getPartnerId(): string {
    return this.partnerId;
  }

  // Check if username/password are configured
  hasCredentials(): boolean {
    return !!(this.username && this.password);
  }
}
