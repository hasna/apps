// DaySchedule Connector — Appointment scheduling, booking pages, and calendar
import { DayScheduleClient } from './client';
import type { DayScheduleConfig, DSBooking, DSBookingList, DSEventType, DSAvailability, DSTeamMember } from '../types';
export { DayScheduleClient } from './client';

export class DaySchedule {
  private readonly client: DayScheduleClient;
  constructor(config: DayScheduleConfig) { this.client = new DayScheduleClient(config); }
  static fromEnv(): DaySchedule {
    const apiKey = process.env.DAYSCHEDULE_API_KEY;
    if (!apiKey) throw new Error('DAYSCHEDULE_API_KEY is required');
    return new DaySchedule({ apiKey });
  }

  async listBookings(options?: { page?: number; per_page?: number; status?: string; event_type_id?: string }): Promise<DSBookingList> {
    return this.client.request<DSBookingList>('/bookings', { params: { page: options?.page, per_page: options?.per_page, status: options?.status, event_type_id: options?.event_type_id } });
  }
  async getBooking(bookingId: string): Promise<DSBooking> { return this.client.request<DSBooking>(`/bookings/${bookingId}`); }
  async cancelBooking(bookingId: string, reason?: string): Promise<void> {
    await this.client.request(`/bookings/${bookingId}/cancel`, { method: 'POST', body: { reason } });
  }

  async listEventTypes(): Promise<DSEventType[]> { return this.client.request<DSEventType[]>('/event-types'); }
  async getEventType(eventTypeId: string): Promise<DSEventType> { return this.client.request<DSEventType>(`/event-types/${eventTypeId}`); }

  async getAvailability(eventTypeId: string, date: string, timezone?: string): Promise<DSAvailability> {
    return this.client.request<DSAvailability>(`/event-types/${eventTypeId}/availability`, { params: { date, timezone } });
  }

  async listTeamMembers(): Promise<DSTeamMember[]> { return this.client.request<DSTeamMember[]>('/team'); }

  getClient(): DayScheduleClient { return this.client; }
}
