// HeySummit Connector — Virtual summit and event management
import { HeySummitClient } from './client';
import type { HeySummitConfig, HSEvent, HSTalk, HSSpeaker, HSAttendee, HSAttendeeList } from '../types';
export { HeySummitClient } from './client';

export class HeySummit {
  private readonly client: HeySummitClient;
  constructor(config: HeySummitConfig) { this.client = new HeySummitClient(config); }
  static fromEnv(): HeySummit {
    const apiKey = process.env.HEYSUMMIT_API_KEY;
    if (!apiKey) throw new Error('HEYSUMMIT_API_KEY is required');
    return new HeySummit({ apiKey });
  }

  async listEvents(): Promise<HSEvent[]> { return this.client.request<HSEvent[]>('/events'); }
  async getEvent(eventId: number): Promise<HSEvent> { return this.client.request<HSEvent>(`/events/${eventId}`); }

  async listTalks(eventId: number): Promise<HSTalk[]> { return this.client.request<HSTalk[]>(`/events/${eventId}/talks`); }
  async getTalk(talkId: number): Promise<HSTalk> { return this.client.request<HSTalk>(`/talks/${talkId}`); }

  async listSpeakers(eventId: number): Promise<HSSpeaker[]> { return this.client.request<HSSpeaker[]>(`/events/${eventId}/speakers`); }
  async getSpeaker(speakerId: number): Promise<HSSpeaker> { return this.client.request<HSSpeaker>(`/speakers/${speakerId}`); }

  async listAttendees(eventId: number, options?: { page?: number }): Promise<HSAttendeeList> {
    return this.client.request<HSAttendeeList>(`/events/${eventId}/attendees`, { params: { page: options?.page } });
  }
  async getAttendee(attendeeId: number): Promise<HSAttendee> { return this.client.request<HSAttendee>(`/attendees/${attendeeId}`); }

  getClient(): HeySummitClient { return this.client; }
}
