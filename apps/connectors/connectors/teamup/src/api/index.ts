// Teamup Connector — Shared calendar and scheduling for teams
import { TeamupClient } from './client';
import type { TeamupConfig, TUEvent, TUEventList, TUSubCalendar } from '../types';
export { TeamupClient } from './client';

export class Teamup {
  private readonly client: TeamupClient;
  constructor(config: TeamupConfig) { this.client = new TeamupClient(config); }
  static fromEnv(): Teamup {
    const apiKey = process.env.TEAMUP_API_KEY;
    const calendarKey = process.env.TEAMUP_CALENDAR_KEY;
    if (!apiKey || !calendarKey) throw new Error('TEAMUP_API_KEY and TEAMUP_CALENDAR_KEY are required');
    return new Teamup({ apiKey, calendarKey });
  }

  async listEvents(options: { startDate: string; endDate: string; subcalendarId?: number[] }): Promise<TUEventList> {
    return this.client.request<TUEventList>('/events', { params: { startDate: options.startDate, endDate: options.endDate, subcalendarId: options.subcalendarId?.join(',') } });
  }
  async getEvent(eventId: string): Promise<{ event: TUEvent }> { return this.client.request(`/events/${eventId}`); }
  async createEvent(data: { subcalendar_id: number; subject: string; start_dt: string; end_dt: string; notes?: string; location?: string; all_day?: boolean }): Promise<{ event: TUEvent }> {
    return this.client.request('/events', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateEvent(eventId: string, data: { subject?: string; start_dt?: string; end_dt?: string; notes?: string }): Promise<{ event: TUEvent }> {
    return this.client.request(`/events/${eventId}`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async deleteEvent(eventId: string): Promise<void> { await this.client.request(`/events/${eventId}`, { method: 'DELETE' }); }

  async listSubCalendars(): Promise<{ subcalendars: TUSubCalendar[] }> { return this.client.request('/subcalendars'); }

  getClient(): TeamupClient { return this.client; }
}
