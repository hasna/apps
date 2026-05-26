import type { GoogleConfig } from '../types';
import { GoogleClient } from './client';
import { GmailApi } from './gmail';
import { DriveApi } from './drive';
import { CalendarApi } from './calendar';
import { DocsApi } from './docs';
import { SheetsApi } from './sheets';

/**
 * Google Workspace API connector
 * Provides access to Gmail, Drive, Calendar, Docs, and Sheets APIs
 */
export class Google {
  private readonly client: GoogleClient;

  // API modules
  public readonly gmail: GmailApi;
  public readonly drive: DriveApi;
  public readonly calendar: CalendarApi;
  public readonly docs: DocsApi;
  public readonly sheets: SheetsApi;

  constructor(config: GoogleConfig) {
    this.client = new GoogleClient(config);
    this.gmail = new GmailApi(this.client);
    this.drive = new DriveApi(this.client);
    this.calendar = new CalendarApi(this.client);
    this.docs = new DocsApi(this.client);
    this.sheets = new SheetsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for GOOGLE_ACCESS_TOKEN
   */
  static fromEnv(): Google {
    const accessToken = process.env.GOOGLE_ACCESS_TOKEN;

    if (!accessToken) {
      throw new Error('GOOGLE_ACCESS_TOKEN environment variable is required');
    }

    return new Google({ accessToken });
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
  getClient(): GoogleClient {
    return this.client;
  }
}

export { GoogleClient } from './client';
export { GmailApi } from './gmail';
export { DriveApi } from './drive';
export { CalendarApi } from './calendar';
export { DocsApi } from './docs';
export { SheetsApi } from './sheets';
