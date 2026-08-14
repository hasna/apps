import type { ZohoBookingsConfig, ZohoBookingsEnvelope } from '../types';
import { ZohoBookingsApiError } from '../types';

const DEFAULT_ORIGIN = 'https://www.zohoapis.com';

/** Encode flat and nested values for Zoho Bookings form POST bodies. */
export function encodeFormBody(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const encoded =
      typeof value === 'object' ? JSON.stringify(value) : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(encoded)}`);
  }
  return parts.join('&');
}

/** Build the bookings JSON API base URL from an origin or full bookings base. */
export function resolveBookingsApiBase(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_ORIGIN).replace(/\/$/, '');
  if (raw.includes('/bookings/v1/json')) return raw;
  if (raw.endsWith('/bookings/v1')) return `${raw}/json`;
  if (raw.endsWith('/bookings')) return `${raw}/v1/json`;
  return `${raw}/bookings/v1/json`;
}

export class ZohoBookingsClient {
  private readonly token: string;
  private readonly apiBase: string;

  constructor(config: ZohoBookingsConfig) {
    if (!config.token) throw new Error('Zoho Bookings OAuth token is required');
    this.token = config.token;
    this.apiBase = resolveBookingsApiBase(config.baseUrl);
  }

  getApiBase(): string {
    return this.apiBase;
  }

  async get<T>(
    endpoint: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = new URL(`${this.apiBase}/${endpoint.replace(/^\//, '')}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Zoho-oauthtoken ${this.token}` },
    });

    return this.parseResponse<T>(response);
  }

  async post<T>(
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.apiBase}/${endpoint.replace(/^\//, '')}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${this.token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body ? encodeFormBody(body) : undefined,
    });

    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    let data: ZohoBookingsEnvelope<T> | Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text) as ZohoBookingsEnvelope<T>;
      } catch {
        throw new ZohoBookingsApiError(
          text || response.statusText,
          response.status,
        );
      }
    }

    const envelope = data as ZohoBookingsEnvelope<T>;
    const apiStatus = envelope.response?.status;
    const errorMessage = envelope.response?.errormessage;

    if (!response.ok || apiStatus === 'failure' || errorMessage) {
      throw new ZohoBookingsApiError(
        errorMessage || response.statusText || 'Zoho Bookings API request failed',
        response.status,
        apiStatus,
      );
    }

    if (envelope.response?.returnvalue !== undefined) {
      return envelope.response.returnvalue;
    }

    return data as T;
  }
}
