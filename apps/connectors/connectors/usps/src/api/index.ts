import type { UspsConfig } from '../types';
import type {
  CreateShipmentParams,
  EventListResponse,
  RawRequestOptions,
  SearchParams,
  SearchResponse,
  Shipment,
  ShipmentListResponse,
} from '../types';
import { UspsClient } from './client';

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export class Usps {
  private readonly client: UspsClient;

  constructor(config: UspsConfig) {
    this.client = new UspsClient(config);
  }

  static fromEnv(): Usps {
    const apiKey = process.env.USPS_API_KEY;
    const baseUrl = process.env.USPS_BASE_URL;

    if (!apiKey) {
      throw new Error('USPS_API_KEY environment variable is required');
    }

    return new Usps({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): UspsClient {
    return this.client;
  }

  async listShipments(params?: Record<string, string | number | boolean | undefined>): Promise<ShipmentListResponse> {
    return this.client.get<ShipmentListResponse>('/shipments', params);
  }

  async getShipment(shipmentId: string): Promise<Shipment> {
    return this.client.get<Shipment>(`/shipments/${encodePathSegment(shipmentId)}`);
  }

  async createShipment(body: CreateShipmentParams): Promise<Shipment> {
    return this.client.post<Shipment>('/shipments', body);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<EventListResponse> {
    return this.client.get<EventListResponse>('/events', params);
  }

  async search(body: SearchParams): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', body);
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request(path, { method, params: query, body, headers });
  }
}

export { UspsClient, DEFAULT_BASE_URL } from './client';
