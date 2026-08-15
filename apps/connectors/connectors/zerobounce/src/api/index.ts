import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ValidationApi } from './validation';
import { AccountApi } from './account';
import { BulkApi } from './bulk';
import { ScoringApi } from './scoring';
import { EnrichmentApi } from './enrichment';

/**
 * ZeroBounce email validation and enrichment connector.
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly validation: ValidationApi;
  public readonly account: AccountApi;
  public readonly bulk: BulkApi;
  public readonly scoring: ScoringApi;
  public readonly enrichment: EnrichmentApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.validation = new ValidationApi(this.client);
    this.account = new AccountApi(this.client);
    this.bulk = new BulkApi(this.client);
    this.scoring = new ScoringApi(this.client);
    this.enrichment = new EnrichmentApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.ZERO_BOUNCE_API_KEY;

    if (!apiKey) {
      throw new Error('ZERO_BOUNCE_API_KEY environment variable is required');
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
export { ValidationApi } from './validation';
export { AccountApi } from './account';
export { BulkApi } from './bulk';
export { ScoringApi } from './scoring';
export { EnrichmentApi } from './enrichment';
