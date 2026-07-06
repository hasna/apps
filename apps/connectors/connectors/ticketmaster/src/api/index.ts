import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { EventsApi } from './events';
import { AttractionsApi } from './attractions';
import { VenuesApi } from './venues';

/**
 * Ticketmaster Discovery API connector.
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly events: EventsApi;
  public readonly attractions: AttractionsApi;
  public readonly venues: VenuesApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.events = new EventsApi(this.client);
    this.attractions = new AttractionsApi(this.client);
    this.venues = new VenuesApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TICKETMASTER_API_KEY;

    if (!apiKey) {
      throw new Error('TICKETMASTER_API_KEY environment variable is required');
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
export { EventsApi } from './events';
export { AttractionsApi } from './attractions';
export { VenuesApi } from './venues';
