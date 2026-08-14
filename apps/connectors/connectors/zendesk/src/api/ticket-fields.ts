import type { ZendeskClient } from './client';
import type {
  ZendeskTicketField,
  ZendeskTicketFieldResponse,
  ZendeskTicketFieldsResponse,
  CreateTicketFieldRequest,
  UpdateTicketFieldRequest,
  TicketFieldListParams,
} from '../types';

/**
 * Zendesk Ticket Fields API
 * @see https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_fields/
 */
export class TicketFieldsApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all ticket fields
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_fields/#list-ticket-fields
   */
  async list(params?: TicketFieldListParams): Promise<ZendeskTicketField[]> {
    const response = await this.client.get<ZendeskTicketFieldsResponse>('/ticket_fields.json', {
      page: params?.page,
      per_page: params?.per_page,
    });
    return response.ticket_fields;
  }

  /**
   * Get a ticket field by ID
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_fields/#show-ticket-field
   */
  async get(ticketFieldId: number): Promise<ZendeskTicketField> {
    const response = await this.client.get<ZendeskTicketFieldResponse>(`/ticket_fields/${ticketFieldId}.json`);
    return response.ticket_field;
  }

  /**
   * Create a new ticket field
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_fields/#create-ticket-field
   */
  async create(data: CreateTicketFieldRequest): Promise<ZendeskTicketField> {
    const response = await this.client.post<ZendeskTicketFieldResponse>('/ticket_fields.json', data);
    return response.ticket_field;
  }

  /**
   * Update a ticket field
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_fields/#update-ticket-field
   */
  async update(ticketFieldId: number, data: UpdateTicketFieldRequest): Promise<ZendeskTicketField> {
    const response = await this.client.put<ZendeskTicketFieldResponse>(`/ticket_fields/${ticketFieldId}.json`, data);
    return response.ticket_field;
  }

  /**
   * Delete a ticket field
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_fields/#delete-ticket-field
   */
  async delete(ticketFieldId: number): Promise<void> {
    await this.client.delete(`/ticket_fields/${ticketFieldId}.json`);
  }

  /**
   * List ticket field options (for dropdown fields)
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_fields/#list-ticket-field-options
   */
  async listOptions(ticketFieldId: number): Promise<Array<{ id: number; name: string; value: string }>> {
    const response = await this.client.get<{ custom_field_options: Array<{ id: number; name: string; value: string }> }>(
      `/ticket_fields/${ticketFieldId}/options.json`
    );
    return response.custom_field_options;
  }

  /**
   * Create or update a ticket field option
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_fields/#create-or-update-ticket-field-option
   */
  async createOrUpdateOption(
    ticketFieldId: number,
    option: { name: string; value: string }
  ): Promise<{ id: number; name: string; value: string }> {
    const response = await this.client.post<{ custom_field_option: { id: number; name: string; value: string } }>(
      `/ticket_fields/${ticketFieldId}/options.json`,
      { custom_field_option: option }
    );
    return response.custom_field_option;
  }

  /**
   * Delete a ticket field option
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_fields/#delete-ticket-field-option
   */
  async deleteOption(ticketFieldId: number, optionId: number): Promise<void> {
    await this.client.delete(`/ticket_fields/${ticketFieldId}/options/${optionId}.json`);
  }
}
