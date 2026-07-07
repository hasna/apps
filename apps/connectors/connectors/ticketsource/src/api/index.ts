import type { TicketSourceConfig, TicketSourceJson, TicketSourceQuery } from '../types';
import { TicketSourceClient } from './client';

export class TicketSource {
  private readonly client: TicketSourceClient;

  constructor(config: TicketSourceConfig) {
    this.client = new TicketSourceClient(config);
  }

  async listEvents(query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.client.listEvents(query);
  }

  async getEvent(eventId: string, query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.client.getEvent(eventId, query);
  }

  async listEventVenues(eventId: string, query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.client.listEventVenues(eventId, query);
  }

  async listEventDates(eventId: string, query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.client.listEventDates(eventId, query);
  }

  async listVenueDates(venueId: string, query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.client.listVenueDates(venueId, query);
  }

  async listCustomers(query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.client.listCustomers(query);
  }

  async getCustomer(customerId: string, query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.client.getCustomer(customerId, query);
  }

  async listBookings(query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.client.listBookings(query);
  }

  static fromEnv(): TicketSource {
    const apiKey = process.env.TICKETSOURCE_API_KEY;
    if (!apiKey) {
      throw new Error('TICKETSOURCE_API_KEY environment variable is required');
    }
    return new TicketSource({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { TicketSourceClient } from './client';
