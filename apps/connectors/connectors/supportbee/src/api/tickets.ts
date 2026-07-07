import type { ConnectorClient } from './client';
import type { Ticket, TicketCreateParams, TicketListParams } from '../types';

export interface TicketListResponse {
  tickets: Ticket[];
  total_count?: number;
  current_page?: number;
  total_pages?: number;
}

export interface TicketResponse {
  ticket: Ticket;
}

export class TicketsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: TicketListParams): Promise<TicketListResponse> {
    return this.client.get<TicketListResponse>('/tickets', params);
  }

  async get(ticketId: number | string): Promise<TicketResponse> {
    return this.client.get<TicketResponse>(`/tickets/${ticketId}`);
  }

  async create(params: TicketCreateParams): Promise<TicketResponse> {
    return this.client.post<TicketResponse>('/tickets', { ticket: params });
  }

  /**
   * Move a ticket to trash (SupportBee soft-deletes tickets).
   */
  async delete(ticketId: number | string): Promise<void> {
    await this.client.delete(`/tickets/${ticketId}`);
  }
}
