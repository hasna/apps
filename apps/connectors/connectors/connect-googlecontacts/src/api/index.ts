import type { GoogleContactsConfig, OAuthTokens } from '../types';
import { GoogleContactsClient } from './client';
import { ContactsApi } from './contacts';

/**
 * Main GoogleContacts class - entry point for the API
 */
export class GoogleContacts {
  private readonly client: GoogleContactsClient;

  // API modules
  public readonly contacts: ContactsApi;

  constructor(config: GoogleContactsConfig) {
    this.client = new GoogleContactsClient(config);
    this.contacts = new ContactsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for:
   * - GOOGLE_CONTACTS_CLIENT_ID
   * - GOOGLE_CONTACTS_CLIENT_SECRET
   * - GOOGLE_CONTACTS_ACCESS_TOKEN (optional)
   * - GOOGLE_CONTACTS_REFRESH_TOKEN (optional)
   */
  static fromEnv(): GoogleContacts {
    const clientId = process.env.GOOGLE_CONTACTS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
    const accessToken = process.env.GOOGLE_CONTACTS_ACCESS_TOKEN;
    const refreshToken = process.env.GOOGLE_CONTACTS_REFRESH_TOKEN;

    if (!clientId) {
      throw new Error('GOOGLE_CONTACTS_CLIENT_ID environment variable is required');
    }
    if (!clientSecret) {
      throw new Error('GOOGLE_CONTACTS_CLIENT_SECRET environment variable is required');
    }

    return new GoogleContacts({
      clientId,
      clientSecret,
      accessToken,
      refreshToken,
    });
  }

  /**
   * Get OAuth authorization URL
   */
  getAuthorizationUrl(scopes?: string): string {
    return this.client.getAuthorizationUrl(scopes);
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string): Promise<OAuthTokens> {
    return this.client.exchangeCode(code);
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(): Promise<OAuthTokens> {
    return this.client.refreshAccessToken();
  }

  /**
   * Set tokens directly
   */
  setTokens(tokens: Partial<OAuthTokens>): void {
    this.client.setTokens(tokens);
  }

  /**
   * Get current tokens
   */
  getTokens(): OAuthTokens {
    return this.client.getTokens();
  }

  /**
   * Get a preview of the client ID (for debugging)
   */
  getClientIdPreview(): string {
    return this.client.getClientIdPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): GoogleContactsClient {
    return this.client;
  }
}

export { GoogleContactsClient } from './client';
export { ContactsApi } from './contacts';
