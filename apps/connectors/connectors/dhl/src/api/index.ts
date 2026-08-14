// DHL Connector — Shipment tracking, rate calculation, and logistics
import { DHLClient } from './client';
import type { DHLConfig, DHLTrackingResult, DHLRateResult, DHLLocation } from '../types';
export { DHLClient } from './client';

export class DHL {
  private readonly client: DHLClient;
  constructor(config: DHLConfig) { this.client = new DHLClient(config); }
  static fromEnv(): DHL {
    const apiKey = process.env.DHL_API_KEY;
    if (!apiKey) throw new Error('DHL_API_KEY is required');
    return new DHL({ apiKey });
  }

  async trackShipment(trackingNumber: string, options?: { service?: string; language?: string }): Promise<DHLTrackingResult> {
    return this.client.request<DHLTrackingResult>('/track/shipments', { trackingNumber, service: options?.service, language: options?.language });
  }

  async getRates(data: { productCode?: string; accountNumber: string; originCountryCode: string; originPostalCode: string; destinationCountryCode: string; destinationPostalCode: string; weight: number; length?: number; width?: number; height?: number }): Promise<DHLRateResult> {
    return this.client.post<DHLRateResult>('/express/rates', { ...data, packages: [{ weight: { value: data.weight }, dimensions: data.length ? { length: data.length, width: data.width, height: data.height } : undefined }] } as Record<string, unknown>);
  }

  async findLocations(countryCode: string, options?: { postalCode?: string; city?: string; radius?: number; limit?: number }): Promise<{ locations: DHLLocation[] }> {
    return this.client.request('/location-finder/v1/find-by-address', { countryCode, postalCode: options?.postalCode, addressLocality: options?.city, radius: options?.radius, limit: options?.limit });
  }

  async findLocationsByGeo(latitude: number, longitude: number, options?: { radius?: number; limit?: number }): Promise<{ locations: DHLLocation[] }> {
    return this.client.request('/location-finder/v1/find-by-geo', { latitude, longitude, radius: options?.radius, limit: options?.limit });
  }

  getClient(): DHLClient { return this.client; }
}
