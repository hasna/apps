import { TicketbudClient } from './client';
import type {
  TicketbudConfig,
  TicketbudEvent,
  TicketbudTicket,
  TicketbudUser,
  EventTotals,
} from '../types';

export { TicketbudClient } from './client';

export class Ticketbud {
  private readonly client: TicketbudClient;

  constructor(config: TicketbudConfig) {
    this.client = new TicketbudClient(config);
  }

  static fromEnv(): Ticketbud {
    const accessToken = process.env.TICKETBUD_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('TICKETBUD_ACCESS_TOKEN is required');
    }
    return new Ticketbud({ accessToken });
  }

  async getMe(): Promise<{ user: TicketbudUser }> {
    return this.client.get<{ user: TicketbudUser }>('/me.json');
  }

  async listEvents(): Promise<{ events: TicketbudEvent[] }> {
    return this.client.get<{ events: TicketbudEvent[] }>('/events.json');
  }

  async getEvent(eventId: string | number): Promise<{ event: TicketbudEvent }> {
    return this.client.get<{ event: TicketbudEvent }>(`/events/${encodeURIComponent(String(eventId))}.json`);
  }

  async getEventTotals(eventId: string | number): Promise<{ event: EventTotals }> {
    return this.client.get<{ event: EventTotals }>(
      `/events/${encodeURIComponent(String(eventId))}/totals.json`,
    );
  }

  async listTickets(eventId: string | number): Promise<{ tickets: TicketbudTicket[] }> {
    return this.client.get<{ tickets: TicketbudTicket[] }>(
      `/events/${encodeURIComponent(String(eventId))}/tickets.json`,
    );
  }

  async getTicket(
    eventId: string | number,
    ticketIdOrBarcode: string | number,
  ): Promise<{ ticket: TicketbudTicket }> {
    const event = encodeURIComponent(String(eventId));
    const ticket = encodeURIComponent(String(ticketIdOrBarcode));
    return this.client.get<{ ticket: TicketbudTicket }>(`/events/${event}/tickets/${ticket}.json`);
  }

  async checkInTicket(
    eventId: string | number,
    ticketIdOrBarcode: string | number,
    options?: { reverse?: boolean },
  ): Promise<{ ticket: TicketbudTicket; meta?: { check_in_count?: number; total_to_scan?: number } }> {
    const event = encodeURIComponent(String(eventId));
    const ticket = encodeURIComponent(String(ticketIdOrBarcode));
    const params: Record<string, string | boolean | undefined> = {};
    if (options?.reverse) {
      params.reverse = 'true';
    }
    return this.client.put<{ ticket: TicketbudTicket; meta?: { check_in_count?: number; total_to_scan?: number } }>(
      `/events/${event}/tickets/${ticket}/check_in.json`,
      params,
    );
  }

  getClient(): TicketbudClient {
    return this.client;
  }
}
