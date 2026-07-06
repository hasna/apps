import type { TalkdeskConfig } from '../types';
import { TalkdeskClient } from './client';
import { UsersApi } from './users';
import { ContactsApi } from './contacts';
import { ReportsApi } from './reports';

/**
 * Main Talkdesk connector.
 * Wraps the Talkdesk API resources behind a single OAuth-authenticated client.
 */
export class Talkdesk {
  private readonly client: TalkdeskClient;

  public readonly users: UsersApi;
  public readonly contacts: ContactsApi;
  public readonly reports: ReportsApi;

  constructor(config: TalkdeskConfig) {
    this.client = new TalkdeskClient(config);
    this.users = new UsersApi(this.client);
    this.contacts = new ContactsApi(this.client);
    this.reports = new ReportsApi(this.client);
  }

  /**
   * Create a Talkdesk client from environment variables.
   * Reads TALKDESK_CLIENT_ID / TALKDESK_CLIENT_SECRET (or TALKDESK_ACCESS_TOKEN),
   * plus optional TALKDESK_BASE_URL and TALKDESK_AUTH_URL.
   */
  static fromEnv(): Talkdesk {
    const clientId = process.env.TALKDESK_CLIENT_ID;
    const clientSecret = process.env.TALKDESK_CLIENT_SECRET;
    const accessToken = process.env.TALKDESK_ACCESS_TOKEN;
    const baseUrl = process.env.TALKDESK_BASE_URL;
    const authUrl = process.env.TALKDESK_AUTH_URL;

    if (!accessToken && (!clientId || !clientSecret)) {
      throw new Error(
        'Set TALKDESK_CLIENT_ID and TALKDESK_CLIENT_SECRET (or TALKDESK_ACCESS_TOKEN) to authenticate'
      );
    }
    return new Talkdesk({ clientId, clientSecret, accessToken, baseUrl, authUrl });
  }

  /** Access the underlying HTTP client for direct API calls. */
  getClient(): TalkdeskClient {
    return this.client;
  }
}

export { TalkdeskClient } from './client';
export { UsersApi } from './users';
export { ContactsApi } from './contacts';
export { ReportsApi } from './reports';
