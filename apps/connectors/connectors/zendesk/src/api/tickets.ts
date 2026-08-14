import type { ZendeskClient } from './client';
import type {
  ZendeskTicket,
  ZendeskTicketResponse,
  ZendeskTicketsResponse,
  CreateTicketRequest,
  UpdateTicketRequest,
  TicketListParams,
} from '../types';

/**
 * Zendesk Tickets API
 * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/
 */
export class TicketsApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all tickets
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#list-tickets
   */
  async list(params?: TicketListParams): Promise<ZendeskTicket[]> {
    const response = await this.client.get<ZendeskTicketsResponse>('/tickets.json', {
      page: params?.page,
      per_page: params?.per_page,
      sort_by: params?.sort_by,
      sort_order: params?.sort_order,
    });
    return response.tickets;
  }

  /**
   * Get a ticket by ID
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#show-ticket
   */
  async get(ticketId: number): Promise<ZendeskTicket> {
    const response = await this.client.get<ZendeskTicketResponse>(`/tickets/${ticketId}.json`);
    return response.ticket;
  }

  /**
   * Create a new ticket
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#create-ticket
   */
  async create(data: CreateTicketRequest): Promise<ZendeskTicket> {
    const response = await this.client.post<ZendeskTicketResponse>('/tickets.json', data);
    return response.ticket;
  }

  /**
   * Update a ticket
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#update-ticket
   */
  async update(ticketId: number, data: UpdateTicketRequest): Promise<ZendeskTicket> {
    const response = await this.client.put<ZendeskTicketResponse>(`/tickets/${ticketId}.json`, data);
    return response.ticket;
  }

  /**
   * Delete a ticket
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#delete-ticket
   */
  async delete(ticketId: number): Promise<void> {
    await this.client.delete(`/tickets/${ticketId}.json`);
  }

  /**
   * List tickets assigned to a user
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#list-tickets
   */
  async listByUser(userId: number, params?: TicketListParams): Promise<ZendeskTicket[]> {
    const response = await this.client.get<ZendeskTicketsResponse>(`/users/${userId}/tickets/requested.json`, {
      page: params?.page,
      per_page: params?.per_page,
    });
    return response.tickets;
  }

  /**
   * List tickets assigned to an organization
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#list-tickets
   */
  async listByOrganization(organizationId: number, params?: TicketListParams): Promise<ZendeskTicket[]> {
    const response = await this.client.get<ZendeskTicketsResponse>(`/organizations/${organizationId}/tickets.json`, {
      page: params?.page,
      per_page: params?.per_page,
    });
    return response.tickets;
  }

  /**
   * Search tickets
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#list-tickets
   */
  async search(query: string, params?: TicketListParams): Promise<ZendeskTicket[]> {
    const response = await this.client.get<ZendeskTicketsResponse>('/search.json', {
      query: `type:ticket ${query}`,
      page: params?.page,
      per_page: params?.per_page,
    });
    return response.tickets;
  }
}
