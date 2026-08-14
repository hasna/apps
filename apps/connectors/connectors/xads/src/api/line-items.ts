import type { XAdsClient } from './client';
import type {
  LineItem,
  CreateLineItemParams,
  UpdateLineItemParams,
  ListResponse,
  PaginationParams,
} from '../types';

/**
 * Line Items (Ad Groups) API
 */
export class LineItemsApi {
  constructor(private client: XAdsClient) {}

  /**
   * List all line items for an account
   */
  async list(
    accountId: string,
    params?: PaginationParams & {
      line_item_ids?: string[];
      campaign_ids?: string[];
      funding_instrument_ids?: string[];
    }
  ): Promise<ListResponse<LineItem>> {
    return this.client.get<ListResponse<LineItem>>(`/accounts/${accountId}/line_items`, {
      cursor: params?.cursor,
      count: params?.count,
      sort_by: params?.sort_by?.join(','),
      with_deleted: params?.with_deleted,
      with_total_count: params?.with_total_count,
      line_item_ids: params?.line_item_ids?.join(','),
      campaign_ids: params?.campaign_ids?.join(','),
      funding_instrument_ids: params?.funding_instrument_ids?.join(','),
    });
  }

  /**
   * Get a specific line item
   */
  async get(
    accountId: string,
    lineItemId: string,
    withDeleted?: boolean
  ): Promise<{ data: LineItem }> {
    return this.client.get<{ data: LineItem }>(
      `/accounts/${accountId}/line_items/${lineItemId}`,
      { with_deleted: withDeleted }
    );
  }

  /**
   * Create a new line item
   */
  async create(accountId: string, params: CreateLineItemParams): Promise<{ data: LineItem }> {
    return this.client.post<{ data: LineItem }>(`/accounts/${accountId}/line_items`, {
      campaign_id: params.campaign_id,
      name: params.name,
      objective: params.objective,
      placements: params.placements,
      bid_amount_local_micro: params.bid_amount_local_micro,
      bid_strategy: params.bid_strategy || 'AUTO',
      charge_by: params.charge_by,
      optimization: params.optimization,
      target_cpa_local_micro: params.target_cpa_local_micro,
      total_budget_amount_local_micro: params.total_budget_amount_local_micro,
      start_time: params.start_time,
      end_time: params.end_time,
      entity_status: params.entity_status || 'PAUSED',
      automatically_select_bid: params.automatically_select_bid,
      advertiser_domain: params.advertiser_domain,
      categories: params.categories,
      primary_web_event_tag: params.primary_web_event_tag,
    });
  }

  /**
   * Update a line item
   */
  async update(
    accountId: string,
    lineItemId: string,
    params: UpdateLineItemParams
  ): Promise<{ data: LineItem }> {
    return this.client.put<{ data: LineItem }>(
      `/accounts/${accountId}/line_items/${lineItemId}`,
      {
        name: params.name,
        bid_amount_local_micro: params.bid_amount_local_micro,
        bid_strategy: params.bid_strategy,
        target_cpa_local_micro: params.target_cpa_local_micro,
        total_budget_amount_local_micro: params.total_budget_amount_local_micro,
        start_time: params.start_time,
        end_time: params.end_time,
        entity_status: params.entity_status,
        automatically_select_bid: params.automatically_select_bid,
        advertiser_domain: params.advertiser_domain,
        primary_web_event_tag: params.primary_web_event_tag,
      }
    );
  }

  /**
   * Delete (soft delete) a line item
   */
  async delete(accountId: string, lineItemId: string): Promise<{ data: LineItem }> {
    return this.client.delete<{ data: LineItem }>(
      `/accounts/${accountId}/line_items/${lineItemId}`
    );
  }

  /**
   * Pause a line item
   */
  async pause(accountId: string, lineItemId: string): Promise<{ data: LineItem }> {
    return this.update(accountId, lineItemId, { entity_status: 'PAUSED' });
  }

  /**
   * Activate a line item
   */
  async activate(accountId: string, lineItemId: string): Promise<{ data: LineItem }> {
    return this.update(accountId, lineItemId, { entity_status: 'ACTIVE' });
  }
}
