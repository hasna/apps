import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { MessagesApi } from './messages';
import { ChannelsApi } from './channels';
import { PresenceApi } from './presence';
import { StatsApi } from './stats';

/**
 * Ably REST API Connector
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly messages: MessagesApi;
  public readonly channels: ChannelsApi;
  public readonly presence: PresenceApi;
  public readonly stats: StatsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.messages = new MessagesApi(this.client);
    this.channels = new ChannelsApi(this.client);
    this.presence = new PresenceApi(this.client);
    this.stats = new StatsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for ABLY_API_KEY
   */
  static fromEnv(): Connector {
    const apiKey = process.env.ABLY_API_KEY;

    if (!apiKey) {
      throw new Error('ABLY_API_KEY environment variable is required');
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
export { MessagesApi } from './messages';
export { ChannelsApi } from './channels';
export { PresenceApi } from './presence';
export { StatsApi } from './stats';
