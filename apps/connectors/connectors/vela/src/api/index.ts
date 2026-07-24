import type { ConnectorConfig, RawRequestParams } from '../types';
import { VelaClient } from './client';
import { SchedulingRequestsApi } from './scheduling-requests';
import { MeetingsApi } from './meetings';
import { ContactsApi } from './contacts';
import { CalendarApi } from './calendar';

/**
 * Vela AI scheduling connector
 */
export class Vela {
  private readonly client: VelaClient;

  public readonly schedulingRequests: SchedulingRequestsApi;
  public readonly meetings: MeetingsApi;
  public readonly contacts: ContactsApi;
  public readonly calendar: CalendarApi;

  constructor(config: ConnectorConfig) {
    this.client = new VelaClient(config);
    this.schedulingRequests = new SchedulingRequestsApi(this.client);
    this.meetings = new MeetingsApi(this.client);
    this.contacts = new ContactsApi(this.client);
    this.calendar = new CalendarApi(this.client);
  }

  static fromEnv(): Vela {
    const apiKey = process.env.VELA_API_KEY;
    if (!apiKey) {
      throw new Error('VELA_API_KEY environment variable is required');
    }

    return new Vela({
      apiKey,
      baseUrl: process.env.VELA_BASE_URL,
    });
  }

  async rawRequest(params: RawRequestParams): Promise<unknown> {
    const { path, method = 'GET', body, params: queryParams } = params;
    return this.client.request(path, { method, body, params: queryParams });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): VelaClient {
    return this.client;
  }
}

export { VelaClient, DEFAULT_BASE_URL } from './client';
export { SchedulingRequestsApi } from './scheduling-requests';
export { MeetingsApi } from './meetings';
export { ContactsApi } from './contacts';
export { CalendarApi } from './calendar';
