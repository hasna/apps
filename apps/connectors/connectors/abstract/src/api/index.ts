import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { GeolocationApi } from './geolocation';
import { EmailApi } from './email';
import { PhoneApi } from './phone';
import { ExchangeApi } from './exchange';
import { CompanyApi } from './company';

/**
 * Abstract API Connector
 * Provides access to IP geolocation, email validation, phone validation,
 * exchange rates, and company enrichment APIs.
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly geolocation: GeolocationApi;
  public readonly email: EmailApi;
  public readonly phone: PhoneApi;
  public readonly exchange: ExchangeApi;
  public readonly company: CompanyApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.geolocation = new GeolocationApi(this.client);
    this.email = new EmailApi(this.client);
    this.phone = new PhoneApi(this.client);
    this.exchange = new ExchangeApi(this.client);
    this.company = new CompanyApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for ABSTRACT_API_KEY
   */
  static fromEnv(): Connector {
    const apiKey = process.env.ABSTRACT_API_KEY;

    if (!apiKey) {
      throw new Error('ABSTRACT_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { GeolocationApi } from './geolocation';
export { EmailApi } from './email';
export { PhoneApi } from './phone';
export { ExchangeApi } from './exchange';
export { CompanyApi } from './company';
