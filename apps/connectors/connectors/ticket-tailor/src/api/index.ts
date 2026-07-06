import type {
  TicketTailorConfig,
  ListQueryParams,
  PingResponse,
  OverviewResponse,
  Event,
  EventsListResponse,
  Order,
  OrdersListResponse,
  IssuedTicket,
  IssuedTicketsListResponse,
} from '../types';
import { TicketTailorClient } from './client';

export class TicketTailor {
  private readonly client: TicketTailorClient;

  constructor(config: TicketTailorConfig) {
    this.client = new TicketTailorClient(config);
  }

  async ping(): Promise<PingResponse> {
    return this.client.ping();
  }

  async getOverview(): Promise<OverviewResponse> {
    return this.client.getOverview();
  }

  async listEvents(params?: ListQueryParams): Promise<EventsListResponse> {
    return this.client.listEvents(params);
  }

  async getEvent(eventId: string): Promise<Event> {
    return this.client.getEvent(eventId);
  }

  async listOrders(params?: ListQueryParams): Promise<OrdersListResponse> {
    return this.client.listOrders(params);
  }

  async getOrder(orderId: string): Promise<Order> {
    return this.client.getOrder(orderId);
  }

  async listIssuedTickets(params?: ListQueryParams): Promise<IssuedTicketsListResponse> {
    return this.client.listIssuedTickets(params);
  }

  async getIssuedTicket(ticketId: string): Promise<IssuedTicket> {
    return this.client.getIssuedTicket(ticketId);
  }

  static fromEnv(): TicketTailor {
    const apiKey = process.env.TICKET_TAILOR_API_KEY;
    if (!apiKey) {
      throw new Error('TICKET_TAILOR_API_KEY environment variable is required');
    }
    return new TicketTailor({ apiKey });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { TicketTailorClient } from './client';
