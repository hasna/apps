import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { SimulationsApi } from './simulations';
import { RoutesApi } from './routes';
import { EnvironmentsApi } from './environments';
import { RawApi } from './raw';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly simulations: SimulationsApi;
  public readonly routes: RoutesApi;
  public readonly environments: EnvironmentsApi;
  public readonly raw: RawApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.simulations = new SimulationsApi(this.client);
    this.routes = new RoutesApi(this.client);
    this.environments = new EnvironmentsApi(this.client);
    this.raw = new RawApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.VALGO_API_KEY;
    if (!apiKey) {
      throw new Error('VALGO_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      baseUrl: process.env.VALGO_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
export { SimulationsApi } from './simulations';
export { RoutesApi } from './routes';
export { EnvironmentsApi } from './environments';
export { RawApi } from './raw';
