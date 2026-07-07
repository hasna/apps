import type { ZohoMeetingConfig } from '../types';
import { ZohoMeetingClient } from './client';
import { SessionsApi } from './sessions';
import { ParticipantsApi } from './participants';
import { WebinarsApi } from './webinars';
import { RecordingsApi } from './recordings';
import { ReportsApi } from './reports';

export class ZohoMeeting {
  private readonly client: ZohoMeetingClient;

  public readonly sessions: SessionsApi;
  public readonly participants: ParticipantsApi;
  public readonly webinars: WebinarsApi;
  public readonly recordings: RecordingsApi;
  public readonly reports: ReportsApi;

  constructor(config: ZohoMeetingConfig) {
    this.client = new ZohoMeetingClient(config);
    this.sessions = new SessionsApi(this.client);
    this.participants = new ParticipantsApi(this.client);
    this.webinars = new WebinarsApi(this.client);
    this.recordings = new RecordingsApi(this.client);
    this.reports = new ReportsApi(this.client);
  }

  static fromEnv(): ZohoMeeting {
    const token = process.env.ZOHO_MEETING_TOKEN;
    if (!token) {
      throw new Error('ZOHO_MEETING_TOKEN environment variable is required');
    }

    return new ZohoMeeting({
      token,
      dataCenter: process.env.ZOHO_MEETING_DATA_CENTER,
      baseUrl: process.env.ZOHO_MEETING_BASE_URL,
    });
  }

  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): ZohoMeetingClient {
    return this.client;
  }
}

export { ZohoMeetingClient, DC_BASES, resolveBaseUrl } from './client';
export { SessionsApi } from './sessions';
export { ParticipantsApi } from './participants';
export { WebinarsApi } from './webinars';
export { RecordingsApi } from './recordings';
export { ReportsApi } from './reports';
