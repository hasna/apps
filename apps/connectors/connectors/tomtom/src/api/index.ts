import type {
  TomTomConfig,
  TomTomSearchResponse,
  TomTomRouteResponse,
} from '../types';
import { TomTomError } from '../types';

export const BASE_URL = 'https://api.tomtom.com';

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export class TomTom {
  private apiKey: string;

  constructor(config: TomTomConfig) {
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    path: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('key', this.apiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new TomTomError(
        `TomTom: invalid JSON response (${response.status})`,
        response.status,
        text.slice(0, 200)
      );
    }

    if (!response.ok) {
      const detail =
        typeof data === 'object' &&
        data !== null &&
        'detailedError' in data &&
        typeof (data as { detailedError?: { message?: string } }).detailedError?.message === 'string'
          ? (data as { detailedError: { message: string } }).detailedError.message
          : text.slice(0, 200);
      throw new TomTomError(
        `TomTom: request failed (${response.status})`,
        response.status,
        detail
      );
    }

    return data as T;
  }

  /**
   * Forward geocode an address or place query.
   */
  async geocode(
    query: string,
    options?: { limit?: number; countrySet?: string }
  ): Promise<TomTomSearchResponse> {
    const encoded = encodePathSegment(query);
    return this.request<TomTomSearchResponse>(`/search/2/geocode/${encoded}.json`, {
      limit: options?.limit,
      countrySet: options?.countrySet,
    });
  }

  /**
   * Reverse geocode coordinates to an address.
   */
  async reverseGeocode(lat: number, lon: number): Promise<TomTomSearchResponse> {
    return this.request<TomTomSearchResponse>(
      `/search/2/reverseGeocode/${lat},${lon}.json`
    );
  }

  /**
   * Search points of interest by text query.
   */
  async poiSearch(
    query: string,
    options?: { limit?: number; countrySet?: string }
  ): Promise<TomTomSearchResponse> {
    const encoded = encodePathSegment(query);
    return this.request<TomTomSearchResponse>(`/search/2/poiSearch/${encoded}.json`, {
      limit: options?.limit,
      countrySet: options?.countrySet,
    });
  }

  /**
   * Calculate a route between origin and destination coordinates.
   */
  async calculateRoute(
    originLat: number,
    originLon: number,
    destinationLat: number,
    destinationLon: number,
    options?: { travelMode?: string }
  ): Promise<TomTomRouteResponse> {
    const path = `/routing/1/calculateRoute/${originLat},${originLon}:${destinationLat},${destinationLon}/json`;
    return this.request<TomTomRouteResponse>(path, {
      travelMode: options?.travelMode ?? 'car',
    });
  }
}

export { encodePathSegment };
