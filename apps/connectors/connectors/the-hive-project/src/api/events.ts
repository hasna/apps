import type { TheHiveProjectClient } from './client';
import type { CustomEventBody } from '../types';

export class CustomEventsApi {
  constructor(private readonly client: TheHiveProjectClient) {}

  async create(caseId: string, body: CustomEventBody): Promise<unknown> {
    const encoded = encodeURIComponent(caseId);
    return this.client.post<unknown>(`/case/${encoded}/customEvent`, body);
  }

  async update(eventId: string, body: CustomEventBody): Promise<unknown> {
    const encoded = encodeURIComponent(eventId);
    return this.client.request<unknown>(`/customEvent/${encoded}`, {
      method: 'PATCH',
      body,
    });
  }

  async delete(eventId: string): Promise<unknown> {
    const encoded = encodeURIComponent(eventId);
    return this.client.request<unknown>(`/customEvent/${encoded}`, {
      method: 'DELETE',
    });
  }
}

export { CustomEventsApi as EventsApi };
