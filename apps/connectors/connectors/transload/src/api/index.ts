import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { SitesApi } from './sites';
import { ShipmentsApi } from './shipments';
import { CamerasApi } from './cameras';
import { MeasurementsApi } from './measurements';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly sites: SitesApi;
  public readonly shipments: ShipmentsApi;
  public readonly cameras: CamerasApi;
  public readonly measurements: MeasurementsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.sites = new SitesApi(this.client);
    this.shipments = new ShipmentsApi(this.client);
    this.cameras = new CamerasApi(this.client);
    this.measurements = new MeasurementsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TRANSLOAD_API_KEY;
    if (!apiKey) {
      throw new Error('TRANSLOAD_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      baseUrl: process.env.TRANSLOAD_BASE_URL,
    });
  }

  async rawRequest<T = unknown>(
    path: string,
    options?: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
    }
  ): Promise<T> {
    return this.client.request<T>(path, options ?? {});
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
export { SitesApi } from './sites';
export { ShipmentsApi } from './shipments';
export { CamerasApi } from './cameras';
export { MeasurementsApi } from './measurements';
