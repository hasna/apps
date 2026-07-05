import { UPSClient, encodePathSegment } from './client';
import type {
  UPSConfig,
  UPSEventList,
  UPSHttpMethod,
  UPSSearchResult,
  UPSShipment,
  UPSShipmentList,
} from '../types';

export { UPSClient, encodePathSegment } from './client';

export class UPS {
  private readonly client: UPSClient;

  constructor(config: UPSConfig) {
    this.client = new UPSClient(config);
  }

  static fromEnv(): UPS {
    const apiKey = process.env.UPS_API_KEY;
    if (!apiKey) throw new Error('UPS_API_KEY is required');
    return new UPS({
      apiKey,
      baseUrl: process.env.UPS_BASE_URL,
    });
  }

  async listShipments(params?: Record<string, string | number | boolean | undefined>): Promise<UPSShipmentList> {
    return this.client.get<UPSShipmentList>('/shipments', params);
  }

  async createShipment(body: Record<string, unknown>): Promise<UPSShipment> {
    return this.client.post<UPSShipment>('/shipments', body);
  }

  async getShipment(shipmentId: string): Promise<UPSShipment> {
    return this.client.get<UPSShipment>(`/shipments/${encodePathSegment(shipmentId)}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<UPSEventList> {
    return this.client.get<UPSEventList>('/events', params);
  }

  async search(body: Record<string, unknown>): Promise<UPSSearchResult> {
    return this.client.post<UPSSearchResult>('/search', body);
  }

  async rawRequest(options: {
    path: string;
    method?: UPSHttpMethod;
    body?: Record<string, unknown>;
    params?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
  }): Promise<unknown> {
    return this.client.request(options.path, {
      method: options.method,
      body: options.body,
      params: options.params,
      headers: options.headers,
    });
  }

  getClient(): UPSClient {
    return this.client;
  }
}
