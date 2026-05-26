import type { ZendeskClient } from './client';
import type {
  ZendeskAutomation,
  ZendeskAutomationResponse,
  ZendeskAutomationsResponse,
  CreateAutomationRequest,
  UpdateAutomationRequest,
  AutomationListParams,
} from '../types';

/**
 * Zendesk Automations API
 * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/automations/
 */
export class AutomationsApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all automations
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/automations/#list-automations
   */
  async list(params?: AutomationListParams): Promise<ZendeskAutomation[]> {
    const response = await this.client.get<ZendeskAutomationsResponse>('/automations.json', {
      page: params?.page,
      per_page: params?.per_page,
      active: params?.active,
      sort_by: params?.sort_by,
      sort_order: params?.sort_order,
    });
    return response.automations;
  }

  /**
   * List active automations
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/automations/#list-active-automations
   */
  async listActive(params?: AutomationListParams): Promise<ZendeskAutomation[]> {
    const response = await this.client.get<ZendeskAutomationsResponse>('/automations/active.json', {
      page: params?.page,
      per_page: params?.per_page,
      sort_by: params?.sort_by,
      sort_order: params?.sort_order,
    });
    return response.automations;
  }

  /**
   * Get an automation by ID
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/automations/#show-automation
   */
  async get(automationId: number): Promise<ZendeskAutomation> {
    const response = await this.client.get<ZendeskAutomationResponse>(`/automations/${automationId}.json`);
    return response.automation;
  }

  /**
   * Create a new automation
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/automations/#create-automation
   */
  async create(data: CreateAutomationRequest): Promise<ZendeskAutomation> {
    const response = await this.client.post<ZendeskAutomationResponse>('/automations.json', data);
    return response.automation;
  }

  /**
   * Update an automation
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/automations/#update-automation
   */
  async update(automationId: number, data: UpdateAutomationRequest): Promise<ZendeskAutomation> {
    const response = await this.client.put<ZendeskAutomationResponse>(`/automations/${automationId}.json`, data);
    return response.automation;
  }

  /**
   * Delete an automation
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/automations/#delete-automation
   */
  async delete(automationId: number): Promise<void> {
    await this.client.delete(`/automations/${automationId}.json`);
  }

  /**
   * Search automations by title
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/automations/#search-automations
   */
  async search(query: string, params?: AutomationListParams): Promise<ZendeskAutomation[]> {
    const response = await this.client.get<ZendeskAutomationsResponse>('/automations/search.json', {
      query,
      page: params?.page,
      per_page: params?.per_page,
      active: params?.active,
    });
    return response.automations;
  }
}
