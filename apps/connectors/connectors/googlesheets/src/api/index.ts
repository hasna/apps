import type { GoogleSheetsConfig } from '../types';
import { GoogleSheetsClient } from './client';
import { SpreadsheetsApi } from './spreadsheets';
import { ValuesApi } from './values';
import { SheetsApi } from './sheets';

/**
 * Google Sheets API Client
 *
 * Supports two authentication methods:
 * 1. API Key - Read-only access to public spreadsheets
 * 2. OAuth - Full read/write access to user's spreadsheets
 */
export class GoogleSheets {
  private readonly client: GoogleSheetsClient;

  /** Spreadsheet metadata and batch update operations */
  public readonly spreadsheets: SpreadsheetsApi;

  /** Cell values read/write operations */
  public readonly values: ValuesApi;

  /** Individual sheet management (add, delete, rename, copy) */
  public readonly sheets: SheetsApi;

  constructor(config: GoogleSheetsConfig) {
    this.client = new GoogleSheetsClient(config);
    this.spreadsheets = new SpreadsheetsApi(this.client);
    this.values = new ValuesApi(this.client);
    this.sheets = new SheetsApi(this.client);
  }

  /**
   * Create a client from environment variables
   *
   * For API key auth (read-only):
   *   GOOGLE_API_KEY
   *
   * For OAuth auth (full access):
   *   GOOGLE_ACCESS_TOKEN (required)
   *   GOOGLE_REFRESH_TOKEN (optional, for auto-refresh)
   *   GOOGLE_CLIENT_ID (required if using refresh token)
   *   GOOGLE_CLIENT_SECRET (required if using refresh token)
   */
  static fromEnv(): GoogleSheets {
    const apiKey = process.env.GOOGLE_API_KEY;
    const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!apiKey && !accessToken) {
      throw new Error(
        'Either GOOGLE_API_KEY or GOOGLE_ACCESS_TOKEN environment variable is required'
      );
    }

    return new GoogleSheets({
      apiKey,
      accessToken,
      refreshToken,
      clientId,
      clientSecret,
    });
  }

  /**
   * Get authentication preview string (for debugging)
   */
  getAuthPreview(): string {
    return this.client.getAuthPreview();
  }

  /**
   * Check if using OAuth authentication
   */
  isOAuthAuth(): boolean {
    return this.client.isOAuthAuth();
  }

  /**
   * Check if using API key authentication
   */
  isApiKeyAuth(): boolean {
    return this.client.isApiKeyAuth();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): GoogleSheetsClient {
    return this.client;
  }

  /**
   * Update access token (e.g., after manual refresh)
   */
  setAccessToken(token: string, expiresAt?: number): void {
    this.client.setAccessToken(token, expiresAt);
  }

  /**
   * Refresh the access token using refresh token
   */
  async refreshAccessToken(): Promise<string> {
    return this.client.refreshAccessToken();
  }
}

export { GoogleSheetsClient } from './client';
export { SpreadsheetsApi } from './spreadsheets';
export { ValuesApi } from './values';
export { SheetsApi } from './sheets';
