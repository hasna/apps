import type { QuoConfig } from '../types';
import { QuoClient } from './client';
import { MessagesApi } from './messages';
import { ContactsApi } from './contacts';
import { ConversationsApi } from './conversations';
import { CallsApi } from './calls';
import { PhoneNumbersApi } from './phone-numbers';
import { UsersApi } from './users';
import { WebhooksApi } from './webhooks';
import { CustomFieldsApi } from './custom-fields';

/**
 * Main Quo (OpenPhone) API class
 */
export class Quo {
  private readonly client: QuoClient;

  // API modules
  public readonly messages: MessagesApi;
  public readonly contacts: ContactsApi;
  public readonly conversations: ConversationsApi;
  public readonly calls: CallsApi;
  public readonly phoneNumbers: PhoneNumbersApi;
  public readonly users: UsersApi;
  public readonly webhooks: WebhooksApi;
  public readonly customFields: CustomFieldsApi;

  constructor(config: QuoConfig) {
    this.client = new QuoClient(config);
    this.messages = new MessagesApi(this.client);
    this.contacts = new ContactsApi(this.client);
    this.conversations = new ConversationsApi(this.client);
    this.calls = new CallsApi(this.client);
    this.phoneNumbers = new PhoneNumbersApi(this.client);
    this.users = new UsersApi(this.client);
    this.webhooks = new WebhooksApi(this.client);
    this.customFields = new CustomFieldsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for QUO_API_KEY
   */
  static fromEnv(): Quo {
    const apiKey = process.env.QUO_API_KEY;

    if (!apiKey) {
      throw new Error('QUO_API_KEY environment variable is required');
    }
    return new Quo({ apiKey });
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
  getClient(): QuoClient {
    return this.client;
  }
}

export { QuoClient } from './client';
export { MessagesApi } from './messages';
export { ContactsApi } from './contacts';
export { ConversationsApi } from './conversations';
export { CallsApi } from './calls';
export { PhoneNumbersApi } from './phone-numbers';
export { UsersApi } from './users';
export { WebhooksApi } from './webhooks';
export { CustomFieldsApi } from './custom-fields';
