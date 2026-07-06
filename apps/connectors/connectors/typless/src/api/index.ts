import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ExtractionApi } from './extraction';
import { TrainingApi } from './training';
import { RawApi } from './raw';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly extraction: ExtractionApi;
  public readonly training: TrainingApi;
  public readonly raw: RawApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.extraction = new ExtractionApi(this.client);
    this.training = new TrainingApi(this.client);
    this.raw = new RawApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TYPLESS_API_KEY;

    if (!apiKey) {
      throw new Error('TYPLESS_API_KEY environment variable is required');
    }

    return new Connector({
      apiKey,
      baseUrl: process.env.TYPLESS_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { ExtractionApi } from './extraction';
export { TrainingApi } from './training';
export { RawApi } from './raw';
