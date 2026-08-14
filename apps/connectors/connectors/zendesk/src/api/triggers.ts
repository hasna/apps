import type { ZendeskClient } from './client';
import type {
  ZendeskTrigger,
  ZendeskTriggerResponse,
  ZendeskTriggersResponse,
  CreateTriggerRequest,
  UpdateTriggerRequest,
  TriggerListParams,
} from '../types';

/**
 * Zendesk Triggers API
 * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/
 */
export class TriggersApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all triggers
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/#list-triggers
   */
  async list(params?: TriggerListParams): Promise<ZendeskTrigger[]> {
    const response = await this.client.get<ZendeskTriggersResponse>('/triggers.json', {
      page: params?.page,
      per_page: params?.per_page,
      active: params?.active,
      category_id: params?.category_id,
      sort_by: params?.sort_by,
      sort_order: params?.sort_order,
    });
    return response.triggers;
  }

  /**
   * List active triggers
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/#list-active-triggers
   */
  async listActive(params?: TriggerListParams): Promise<ZendeskTrigger[]> {
    const response = await this.client.get<ZendeskTriggersResponse>('/triggers/active.json', {
      page: params?.page,
      per_page: params?.per_page,
      category_id: params?.category_id,
      sort_by: params?.sort_by,
      sort_order: params?.sort_order,
    });
    return response.triggers;
  }

  /**
   * Get a trigger by ID
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/#show-trigger
   */
  async get(triggerId: number): Promise<ZendeskTrigger> {
    const response = await this.client.get<ZendeskTriggerResponse>(`/triggers/${triggerId}.json`);
    return response.trigger;
  }

  /**
   * Create a new trigger
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/#create-trigger
   */
  async create(data: CreateTriggerRequest): Promise<ZendeskTrigger> {
    const response = await this.client.post<ZendeskTriggerResponse>('/triggers.json', data);
    return response.trigger;
  }

  /**
   * Update a trigger
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/#update-trigger
   */
  async update(triggerId: number, data: UpdateTriggerRequest): Promise<ZendeskTrigger> {
    const response = await this.client.put<ZendeskTriggerResponse>(`/triggers/${triggerId}.json`, data);
    return response.trigger;
  }

  /**
   * Delete a trigger
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/#delete-trigger
   */
  async delete(triggerId: number): Promise<void> {
    await this.client.delete(`/triggers/${triggerId}.json`);
  }

  /**
   * Reorder triggers
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/#reorder-triggers
   */
  async reorder(triggerIds: number[]): Promise<void> {
    await this.client.put('/triggers/reorder.json', { trigger_ids: triggerIds });
  }

  /**
   * Search triggers by title
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/#search-triggers
   */
  async search(query: string, params?: TriggerListParams): Promise<ZendeskTrigger[]> {
    const response = await this.client.get<ZendeskTriggersResponse>('/triggers/search.json', {
      query,
      page: params?.page,
      per_page: params?.per_page,
      active: params?.active,
    });
    return response.triggers;
  }

  /**
   * Get trigger revision (history)
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/#list-trigger-revisions
   */
  async listRevisions(triggerId: number): Promise<Array<{ id: number; author_id: number; created_at: string; url: string }>> {
    const response = await this.client.get<{ trigger_revisions: Array<{ id: number; author_id: number; created_at: string; url: string }> }>(
      `/triggers/${triggerId}/revisions.json`
    );
    return response.trigger_revisions;
  }

  /**
   * Get a specific trigger revision
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/#show-trigger-revision
   */
  async getRevision(triggerId: number, revisionId: number): Promise<ZendeskTrigger> {
    const response = await this.client.get<ZendeskTriggerResponse>(`/triggers/${triggerId}/revisions/${revisionId}.json`);
    return response.trigger;
  }
}
