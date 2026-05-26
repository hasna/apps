import type { IMessageConfig } from '../types';
import { ImessageClient } from './client';
import { HealthApi } from './health';
import { ConversationsApi } from './conversations';
import { MessagesApi } from './messages';

/**
 * Main iMessage Connector class
 * Provides access to iMessage via a bridge API
 */
export class IMessage {
  private readonly client: ImessageClient;

  // Service APIs
  public readonly health: HealthApi;
  public readonly conversations: ConversationsApi;
  public readonly messages: MessagesApi;

  constructor(config: IMessageConfig) {
    this.client = new ImessageClient(config);
    this.health = new HealthApi(this.client);
    this.conversations = new ConversationsApi(this.client);
    this.messages = new MessagesApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for IMESSAGE_BRIDGE_URL, IMESSAGE_API_KEY, IMESSAGE_DEVICE_ID
   */
  static fromEnv(): IMessage {
    const bridgeUrl = process.env.IMESSAGE_BRIDGE_URL;

    if (!bridgeUrl) {
      throw new Error('IMESSAGE_BRIDGE_URL environment variable is required');
    }

    return new IMessage({
      bridgeUrl,
      apiKey: process.env.IMESSAGE_API_KEY,
      deviceId: process.env.IMESSAGE_DEVICE_ID,
    });
  }

  /**
   * Get the bridge URL preview
   */
  getBridgeUrlPreview(): string {
    return this.client.getBridgeUrlPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ImessageClient {
    return this.client;
  }
}

export { ImessageClient } from './client';
export { HealthApi } from './health';
export { ConversationsApi } from './conversations';
export { MessagesApi } from './messages';
