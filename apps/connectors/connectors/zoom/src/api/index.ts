import type { ZoomConfig } from '../types';
import { ZoomClient } from './client';
import { UsersApi } from './users';
import { MeetingsApi } from './meetings';
import { WebinarsApi } from './webinars';
import { RecordingsApi } from './recordings';
import { ReportsApi } from './reports';

/**
 * Main Zoom Connector class
 * Provides access to Users, Meetings, Webinars, Recordings, and Reports APIs
 */
export class Zoom {
  private readonly client: ZoomClient;

  // Service APIs
  public readonly users: UsersApi;
  public readonly meetings: MeetingsApi;
  public readonly webinars: WebinarsApi;
  public readonly recordings: RecordingsApi;
  public readonly reports: ReportsApi;

  constructor(config: ZoomConfig) {
    this.client = new ZoomClient(config);
    this.users = new UsersApi(this.client);
    this.meetings = new MeetingsApi(this.client);
    this.webinars = new WebinarsApi(this.client);
    this.recordings = new RecordingsApi(this.client);
    this.reports = new ReportsApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
   */
  static fromEnv(): Zoom {
    const accountId = process.env.ZOOM_ACCOUNT_ID;
    const clientId = process.env.ZOOM_CLIENT_ID;
    const clientSecret = process.env.ZOOM_CLIENT_SECRET;

    if (!accountId) {
      throw new Error('ZOOM_ACCOUNT_ID environment variable is required');
    }
    if (!clientId) {
      throw new Error('ZOOM_CLIENT_ID environment variable is required');
    }
    if (!clientSecret) {
      throw new Error('ZOOM_CLIENT_SECRET environment variable is required');
    }

    return new Zoom({ accountId, clientId, clientSecret });
  }

  /**
   * Get a preview of the client ID (for debugging)
   */
  getClientIdPreview(): string {
    return this.client.getClientIdPreview();
  }

  /**
   * Get the account ID
   */
  getAccountId(): string {
    return this.client.getAccountId();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): ZoomClient {
    return this.client;
  }
}

export { ZoomClient } from './client';
export { UsersApi } from './users';
export { MeetingsApi } from './meetings';
export { WebinarsApi } from './webinars';
export { RecordingsApi } from './recordings';
export { ReportsApi } from './reports';
