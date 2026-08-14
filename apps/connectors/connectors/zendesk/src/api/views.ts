import type { ZendeskClient } from './client';
import type {
  ZendeskView,
  ZendeskViewResponse,
  ZendeskViewsResponse,
  ZendeskViewCountResponse,
  ZendeskViewExecuteResponse,
  CreateViewRequest,
  UpdateViewRequest,
  ViewListParams,
} from '../types';

/**
 * Zendesk Views API
 * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/
 */
export class ViewsApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all views
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#list-views
   */
  async list(params?: ViewListParams): Promise<ZendeskView[]> {
    const response = await this.client.get<ZendeskViewsResponse>('/views.json', {
      page: params?.page,
      per_page: params?.per_page,
      active: params?.active,
      group_id: params?.group_id,
      sort_by: params?.sort_by,
      sort_order: params?.sort_order,
    });
    return response.views;
  }

  /**
   * List active views
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#list-active-views
   */
  async listActive(params?: ViewListParams): Promise<ZendeskView[]> {
    const response = await this.client.get<ZendeskViewsResponse>('/views/active.json', {
      page: params?.page,
      per_page: params?.per_page,
      group_id: params?.group_id,
      sort_by: params?.sort_by,
      sort_order: params?.sort_order,
    });
    return response.views;
  }

  /**
   * List compact views (minimal data)
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#list-views-compact
   */
  async listCompact(): Promise<ZendeskView[]> {
    const response = await this.client.get<ZendeskViewsResponse>('/views/compact.json');
    return response.views;
  }

  /**
   * Get a view by ID
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#show-view
   */
  async get(viewId: number): Promise<ZendeskView> {
    const response = await this.client.get<ZendeskViewResponse>(`/views/${viewId}.json`);
    return response.view;
  }

  /**
   * Create a new view
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#create-view
   */
  async create(data: CreateViewRequest): Promise<ZendeskView> {
    const response = await this.client.post<ZendeskViewResponse>('/views.json', data);
    return response.view;
  }

  /**
   * Update a view
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#update-view
   */
  async update(viewId: number, data: UpdateViewRequest): Promise<ZendeskView> {
    const response = await this.client.put<ZendeskViewResponse>(`/views/${viewId}.json`, data);
    return response.view;
  }

  /**
   * Delete a view
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#delete-view
   */
  async delete(viewId: number): Promise<void> {
    await this.client.delete(`/views/${viewId}.json`);
  }

  /**
   * Execute a view (get tickets matching view criteria)
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#execute-view
   */
  async execute(viewId: number, params?: { page?: number; per_page?: number; sort_by?: string; sort_order?: 'asc' | 'desc' }): Promise<ZendeskViewExecuteResponse> {
    return this.client.get<ZendeskViewExecuteResponse>(`/views/${viewId}/execute.json`, params);
  }

  /**
   * Get ticket count for a view
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#show-view-count
   */
  async count(viewId: number): Promise<ZendeskViewCountResponse> {
    return this.client.get<ZendeskViewCountResponse>(`/views/${viewId}/count.json`);
  }

  /**
   * Get ticket counts for multiple views
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#show-view-counts
   */
  async counts(viewIds: number[]): Promise<{ view_counts: Array<{ view_id: number; value: number; url: string }> }> {
    return this.client.get<{ view_counts: Array<{ view_id: number; value: number; url: string }> }>('/views/count_many.json', {
      ids: viewIds.join(','),
    });
  }

  /**
   * Preview a view (test conditions without saving)
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#preview-view
   */
  async preview(data: CreateViewRequest): Promise<ZendeskViewExecuteResponse> {
    return this.client.post<ZendeskViewExecuteResponse>('/views/preview.json', data);
  }

  /**
   * Get count for a preview view
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#preview-view-count
   */
  async previewCount(data: CreateViewRequest): Promise<ZendeskViewCountResponse> {
    return this.client.post<ZendeskViewCountResponse>('/views/preview/count.json', data);
  }

  /**
   * Search views by title
   * @see https://developer.zendesk.com/api-reference/ticketing/business-rules/views/#search-views
   */
  async search(query: string): Promise<ZendeskView[]> {
    const response = await this.client.get<ZendeskViewsResponse>('/views/search.json', { query });
    return response.views;
  }
}
