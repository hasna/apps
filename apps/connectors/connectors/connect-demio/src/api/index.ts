// Demio Connector — Webinar platform for events and attendee management
import { DemioClient } from './client';
import type { DemioConfig, DemioEvent, DemioDate, DemioRegistrant, DemioParticipant } from '../types';
export { DemioClient } from './client';

export class Demio {
  private readonly client: DemioClient;
  constructor(config: DemioConfig) { this.client = new DemioClient(config); }
  static fromEnv(): Demio {
    const apiKey = process.env.DEMIO_API_KEY;
    const apiSecret = process.env.DEMIO_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error('DEMIO_API_KEY and DEMIO_API_SECRET are required');
    return new Demio({ apiKey, apiSecret });
  }

  async listEvents(options?: { type?: string }): Promise<DemioEvent[]> {
    return this.client.request<DemioEvent[]>('/events', { params: { type: options?.type } });
  }
  async getEvent(eventId: number): Promise<DemioEvent> { return this.client.request<DemioEvent>(`/event/${eventId}`); }

  async listDates(eventId: number): Promise<DemioDate[]> { return this.client.request<DemioDate[]>(`/event/${eventId}/dates`); }
  async getDate(dateId: number): Promise<DemioDate> { return this.client.request<DemioDate>(`/event/date/${dateId}`); }

  async register(dateId: number, data: { name: string; email: string }): Promise<DemioRegistrant> {
    return this.client.request<DemioRegistrant>(`/event/date/${dateId}/register`, { method: 'PUT', body: data as Record<string, unknown> });
  }
  async listRegistrants(dateId: number): Promise<DemioRegistrant[]> {
    return this.client.request<DemioRegistrant[]>(`/event/date/${dateId}/registrants`);
  }

  async listParticipants(dateId: number): Promise<DemioParticipant[]> {
    return this.client.request<DemioParticipant[]>(`/event/date/${dateId}/participants`);
  }

  async ping(): Promise<{ status: string }> { return this.client.request('/ping'); }

  getClient(): DemioClient { return this.client; }
}
