// GoTo Webinar Connector — Webinar hosting and management
import { GoToWebinarClient } from './client';
import type { GoToWebinarConfig, GTWWebinar, GTWRegistrant, GTWAttendee, GTWSession } from '../types';
export { GoToWebinarClient } from './client';

export class GoToWebinar {
  private readonly client: GoToWebinarClient;
  constructor(config: GoToWebinarConfig) { this.client = new GoToWebinarClient(config); }
  static fromEnv(): GoToWebinar {
    const token = process.env.GOTOWEBINAR_TOKEN;
    const organizerKey = process.env.GOTOWEBINAR_ORGANIZER_KEY;
    if (!token || !organizerKey) throw new Error('GOTOWEBINAR_TOKEN and GOTOWEBINAR_ORGANIZER_KEY are required');
    return new GoToWebinar({ token, organizerKey });
  }

  async listWebinars(options?: { fromTime?: string; toTime?: string }): Promise<GTWWebinar[]> {
    return this.client.request<GTWWebinar[]>(`/organizers/${this.client.getOrganizerKey()}/webinars`, { params: { fromTime: options?.fromTime, toTime: options?.toTime } });
  }
  async getWebinar(webinarKey: string): Promise<GTWWebinar> {
    return this.client.request<GTWWebinar>(`/organizers/${this.client.getOrganizerKey()}/webinars/${webinarKey}`);
  }
  async createWebinar(data: { subject: string; description?: string; times: { startTime: string; endTime: string }[] }): Promise<{ webinarKey: string }> {
    return this.client.request(`/organizers/${this.client.getOrganizerKey()}/webinars`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async cancelWebinar(webinarKey: string): Promise<void> {
    await this.client.request(`/organizers/${this.client.getOrganizerKey()}/webinars/${webinarKey}`, { method: 'DELETE' });
  }

  async listRegistrants(webinarKey: string): Promise<GTWRegistrant[]> {
    return this.client.request<GTWRegistrant[]>(`/organizers/${this.client.getOrganizerKey()}/webinars/${webinarKey}/registrants`);
  }
  async createRegistrant(webinarKey: string, data: { firstName: string; lastName: string; email: string }): Promise<{ registrantKey: string; joinUrl: string }> {
    return this.client.request(`/organizers/${this.client.getOrganizerKey()}/webinars/${webinarKey}/registrants`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listSessions(webinarKey: string): Promise<GTWSession[]> {
    return this.client.request<GTWSession[]>(`/organizers/${this.client.getOrganizerKey()}/webinars/${webinarKey}/sessions`);
  }
  async listAttendees(webinarKey: string, sessionKey: string): Promise<GTWAttendee[]> {
    return this.client.request<GTWAttendee[]>(`/organizers/${this.client.getOrganizerKey()}/webinars/${webinarKey}/sessions/${sessionKey}/attendees`);
  }

  getClient(): GoToWebinarClient { return this.client; }
}
