// WebinarJam Connector — Live webinar hosting and streaming
import { WebinarJamClient } from './client';
import type { WebinarJamConfig, WJWebinar, WJRegistrantResult } from '../types';
export { WebinarJamClient } from './client';

export class WebinarJam {
  private readonly client: WebinarJamClient;
  constructor(config: WebinarJamConfig) { this.client = new WebinarJamClient(config); }
  static fromEnv(): WebinarJam {
    const apiKey = process.env.WEBINARJAM_API_KEY;
    if (!apiKey) throw new Error('WEBINARJAM_API_KEY is required');
    return new WebinarJam({ apiKey });
  }

  async listWebinars(): Promise<{ webinars: WJWebinar[] }> { return this.client.request('/webinars'); }
  async getWebinar(webinarId: string): Promise<{ webinar: WJWebinar }> {
    return this.client.request('/webinar', { webinar_id: webinarId });
  }

  async registerAttendee(webinarId: string, data: { first_name: string; last_name?: string; email: string; schedule: number }): Promise<WJRegistrantResult> {
    return this.client.request('/register', { webinar_id: webinarId, ...data });
  }

  getClient(): WebinarJamClient { return this.client; }
}
