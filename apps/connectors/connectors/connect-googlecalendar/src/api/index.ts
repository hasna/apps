import type { GoogleCalendarConfig } from '../types';
import { GoogleCalendarClient, CALENDAR_SCOPES } from './client';
import { CalendarsApi } from './calendars';
import { EventsApi } from './events';

/**
 * Main GoogleCalendar class
 */
export class GoogleCalendar {
  private readonly client: GoogleCalendarClient;

  // API modules
  public readonly calendars: CalendarsApi;
  public readonly events: EventsApi;

  constructor(config: GoogleCalendarConfig) {
    this.client = new GoogleCalendarClient(config);
    this.calendars = new CalendarsApi(this.client);
    this.events = new EventsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for GOOGLE_CALENDAR_ACCESS_TOKEN
   */
  static fromEnv(): GoogleCalendar {
    const accessToken = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
    const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

    if (!accessToken) {
      throw new Error('GOOGLE_CALENDAR_ACCESS_TOKEN environment variable is required');
    }
    return new GoogleCalendar({ accessToken, refreshToken, clientId, clientSecret });
  }

  /**
   * Get OAuth2 authorization URL for user consent
   */
  static getAuthorizationUrl(
    clientId: string,
    redirectUri: string,
    scopes: string[] = CALENDAR_SCOPES,
    accessType: 'online' | 'offline' = 'offline',
    prompt: 'none' | 'consent' | 'select_account' = 'consent'
  ): string {
    return GoogleCalendarClient.getAuthorizationUrl(clientId, redirectUri, scopes, accessType, prompt);
  }

  /**
   * Exchange authorization code for access tokens
   */
  static async exchangeCodeForTokens(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    tokenType?: string;
    scope?: string;
  }> {
    return GoogleCalendarClient.exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);
  }

  /**
   * Refresh the access token
   */
  async refreshAccessToken(): Promise<{
    accessToken: string;
    expiresIn?: number;
  }> {
    return this.client.refreshAccessToken();
  }

  /**
   * Get a preview of the access token (for debugging)
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): GoogleCalendarClient {
    return this.client;
  }
}

export { GoogleCalendarClient, CALENDAR_SCOPES } from './client';
export { CalendarsApi } from './calendars';
export { EventsApi } from './events';
