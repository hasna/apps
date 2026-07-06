import type { TelnyxConfig } from '../types';
import { TelnyxClient } from './client';
import { MessagesApi } from './messages';
import { PhoneNumbersApi } from './phone-numbers';
import { AvailableNumbersApi } from './available-numbers';
import { MessagingProfilesApi } from './messaging-profiles';
import { NumberLookupApi } from './number-lookup';

/**
 * Main Telnyx connector class.
 * Aggregates the individual Telnyx v2 API modules.
 */
export class Telnyx {
  private readonly client: TelnyxClient;

  public readonly messages: MessagesApi;
  public readonly phoneNumbers: PhoneNumbersApi;
  public readonly availableNumbers: AvailableNumbersApi;
  public readonly messagingProfiles: MessagingProfilesApi;
  public readonly numberLookup: NumberLookupApi;

  constructor(config: TelnyxConfig) {
    this.client = new TelnyxClient(config);

    this.messages = new MessagesApi(this.client);
    this.phoneNumbers = new PhoneNumbersApi(this.client);
    this.availableNumbers = new AvailableNumbersApi(this.client);
    this.messagingProfiles = new MessagingProfilesApi(this.client);
    this.numberLookup = new NumberLookupApi(this.client);
  }

  /**
   * Create a client from the `TELNYX_API_KEY` environment variable.
   */
  static fromEnv(): Telnyx {
    const apiKey = process.env.TELNYX_API_KEY;
    if (!apiKey) {
      throw new Error('TELNYX_API_KEY environment variable is required');
    }
    return new Telnyx({ apiKey });
  }

  /**
   * Get the underlying client for direct API access.
   */
  getClient(): TelnyxClient {
    return this.client;
  }

  /**
   * Masked preview of the configured API key.
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { TelnyxClient } from './client';
export { MessagesApi } from './messages';
export { PhoneNumbersApi } from './phone-numbers';
export { AvailableNumbersApi } from './available-numbers';
export { MessagingProfilesApi } from './messaging-profiles';
export { NumberLookupApi } from './number-lookup';
