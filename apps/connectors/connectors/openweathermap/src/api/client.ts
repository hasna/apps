import type { WeatherConfig, Units } from '../types';
import { WeatherApiError } from '../types';

const BASE_URL = 'https://api.openweathermap.org';

export interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
}

export class OpenWeatherMapClient {
  private readonly apiKey: string;
  private readonly units: Units;
  private readonly lang: string;

  constructor(config: WeatherConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.units = config.units || 'metric';
    this.lang = config.lang || 'en';
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${BASE_URL}${path}`);

    // Always include API key, units, and language
    url.searchParams.append('appid', this.apiKey);
    url.searchParams.append('units', this.units);
    url.searchParams.append('lang', this.lang);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.append(key, String(value));
        }
      });
    }

    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.params);

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      const errorMessage = data.message || response.statusText;
      throw new WeatherApiError(errorMessage, response.status, data.cod?.toString());
    }

    return data as T;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>(path, { params });
  }

  getUnits(): Units {
    return this.units;
  }

  getUnitSymbol(type: 'temp' | 'speed'): string {
    switch (this.units) {
      case 'imperial':
        return type === 'temp' ? '°F' : 'mph';
      case 'standard':
        return type === 'temp' ? 'K' : 'm/s';
      case 'metric':
      default:
        return type === 'temp' ? '°C' : 'm/s';
    }
  }
}
