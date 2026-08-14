import type { ZohoMeetingClient } from './client';

export class ReportsApi {
  constructor(private readonly client: ZohoMeetingClient) {}

  getSessionReport(sessionKey: string) {
    return this.client.request(`/sessions/${encodeURIComponent(sessionKey)}/report`);
  }

  getWebinarReport(webinarKey: string) {
    return this.client.request(`/webinars/${encodeURIComponent(webinarKey)}/report`);
  }
}
