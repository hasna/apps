import type { ConnectorClient } from './client';
import type { Event, EventCreateParams, AttendanceCreateParams, ListParams } from '../types';

export class EventsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    if (params?.filter) queryParams.filter = params.filter;
    return this.client.get<unknown>('/events', queryParams);
  }

  async get(eventId: string): Promise<Event> {
    return this.client.get<Event>(`/events/${eventId}`);
  }

  async create(params: EventCreateParams): Promise<Event> {
    return this.client.post<Event>('/events', params);
  }

  async update(eventId: string, params: Partial<EventCreateParams>): Promise<Event> {
    return this.client.put<Event>(`/events/${eventId}`, params);
  }

  async listAttendances(eventId: string, params?: ListParams): Promise<unknown> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.page) queryParams.page = params.page;
    if (params?.per_page) queryParams.per_page = params.per_page;
    return this.client.get<unknown>(`/events/${eventId}/attendances`, queryParams);
  }

  async createAttendance(eventId: string, params: AttendanceCreateParams): Promise<unknown> {
    return this.client.post<unknown>(`/events/${eventId}/attendances`, params);
  }
}
