import type { ZendeskClient } from './client';
import type {
  ZendeskMacro,
  ZendeskMacroResponse,
  ZendeskMacrosResponse,
  CreateMacroRequest,
  UpdateMacroRequest,
  MacroListParams,
} from '../types';

/**
 * Zendesk Macros API
 * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/
 */
export class MacrosApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all macros
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/#list-macros
   */
  async list(params?: MacroListParams): Promise<ZendeskMacro[]> {
    const response = await this.client.get<ZendeskMacrosResponse>('/macros.json', {
      page: params?.page,
      per_page: params?.per_page,
      active: params?.active,
      category: params?.category,
      group_id: params?.group_id,
      sort_by: params?.sort_by,
      sort_order: params?.sort_order,
    });
    return response.macros;
  }

  /**
   * List active macros
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/#list-active-macros
   */
  async listActive(params?: MacroListParams): Promise<ZendeskMacro[]> {
    const response = await this.client.get<ZendeskMacrosResponse>('/macros/active.json', {
      page: params?.page,
      per_page: params?.per_page,
      category: params?.category,
      group_id: params?.group_id,
      sort_by: params?.sort_by,
      sort_order: params?.sort_order,
    });
    return response.macros;
  }

  /**
   * Get a macro by ID
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/#show-macro
   */
  async get(macroId: number): Promise<ZendeskMacro> {
    const response = await this.client.get<ZendeskMacroResponse>(`/macros/${macroId}.json`);
    return response.macro;
  }

  /**
   * Create a new macro
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/#create-macro
   */
  async create(data: CreateMacroRequest): Promise<ZendeskMacro> {
    const response = await this.client.post<ZendeskMacroResponse>('/macros.json', data);
    return response.macro;
  }

  /**
   * Update a macro
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/#update-macro
   */
  async update(macroId: number, data: UpdateMacroRequest): Promise<ZendeskMacro> {
    const response = await this.client.put<ZendeskMacroResponse>(`/macros/${macroId}.json`, data);
    return response.macro;
  }

  /**
   * Delete a macro
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/#delete-macro
   */
  async delete(macroId: number): Promise<void> {
    await this.client.delete(`/macros/${macroId}.json`);
  }

  /**
   * Apply a macro to a ticket (preview)
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/#show-changes-to-ticket
   */
  async apply(macroId: number, ticketId: number): Promise<{ result: { ticket: unknown; comment: unknown } }> {
    return this.client.get(`/macros/${macroId}/apply.json`, { ticket_id: ticketId });
  }

  /**
   * Search macros by title
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/#search-macros
   */
  async search(query: string, params?: MacroListParams): Promise<ZendeskMacro[]> {
    const response = await this.client.get<ZendeskMacrosResponse>('/macros/search.json', {
      query,
      page: params?.page,
      per_page: params?.per_page,
      active: params?.active,
    });
    return response.macros;
  }

  /**
   * List macro categories
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/#list-macro-categories
   */
  async listCategories(): Promise<{ categories: string[] }> {
    return this.client.get('/macros/categories.json');
  }

  /**
   * List macros applicable to a ticket
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/#list-macros-applicable-to-a-ticket
   */
  async listApplicable(ticketId: number): Promise<ZendeskMacro[]> {
    const response = await this.client.get<ZendeskMacrosResponse>(`/tickets/${ticketId}/macros.json`);
    return response.macros;
  }
}
