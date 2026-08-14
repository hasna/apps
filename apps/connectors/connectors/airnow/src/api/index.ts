// AirNow Connector — US EPA air quality data (AQI observations and forecasts)
import { AirNowClient } from './client';
import type { AirNowConfig, AirNowObservation, AirNowForecast } from '../types';
export { AirNowClient } from './client';

export class AirNow {
  private readonly client: AirNowClient;
  constructor(config: AirNowConfig) { this.client = new AirNowClient(config); }
  static fromEnv(): AirNow {
    const apiKey = process.env.AIRNOW_API_KEY;
    if (!apiKey) throw new Error('AIRNOW_API_KEY is required');
    return new AirNow({ apiKey });
  }

  async getCurrentByZip(zipCode: string, options?: { distance?: number }): Promise<AirNowObservation[]> {
    return this.client.request<AirNowObservation[]>('/observation/zipCode/current/', { zipCode, distance: options?.distance });
  }

  async getCurrentByLatLon(latitude: number, longitude: number, options?: { distance?: number }): Promise<AirNowObservation[]> {
    return this.client.request<AirNowObservation[]>('/observation/latLong/current/', { latitude, longitude, distance: options?.distance });
  }

  async getHistoricalByZip(zipCode: string, date: string, options?: { distance?: number }): Promise<AirNowObservation[]> {
    return this.client.request<AirNowObservation[]>('/observation/zipCode/historical/', { zipCode, date, distance: options?.distance });
  }

  async getHistoricalByLatLon(latitude: number, longitude: number, date: string, options?: { distance?: number }): Promise<AirNowObservation[]> {
    return this.client.request<AirNowObservation[]>('/observation/latLong/historical/', { latitude, longitude, date, distance: options?.distance });
  }

  async getForecastByZip(zipCode: string, options?: { date?: string; distance?: number }): Promise<AirNowForecast[]> {
    return this.client.request<AirNowForecast[]>('/forecast/zipCode/', { zipCode, date: options?.date, distance: options?.distance });
  }

  async getForecastByLatLon(latitude: number, longitude: number, options?: { date?: string; distance?: number }): Promise<AirNowForecast[]> {
    return this.client.request<AirNowForecast[]>('/forecast/latLong/', { latitude, longitude, date: options?.date, distance: options?.distance });
  }

  getClient(): AirNowClient { return this.client; }
}
