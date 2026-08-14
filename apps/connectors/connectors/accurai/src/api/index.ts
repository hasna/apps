import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { DocumentsApi } from './documents';
import { PredictionsApi } from './predictions';
import { ModelsApi } from './models';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly documents: DocumentsApi;
  public readonly predictions: PredictionsApi;
  public readonly models: ModelsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.documents = new DocumentsApi(this.client);
    this.predictions = new PredictionsApi(this.client);
    this.models = new ModelsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.ACCURAI_API_KEY;

    if (!apiKey) {
      throw new Error('ACCURAI_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { DocumentsApi } from './documents';
export { PredictionsApi } from './predictions';
export { ModelsApi } from './models';
