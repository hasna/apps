import { ClickBankClient } from './client';
import type {
  Ticket,
  TicketsListParams,
  TicketsCountParams,
  CreateTicketParams,
  UpdateTicketParams,
  RefundAmountsParams,
  RefundAmountData,
} from '../types';

interface TicketResponse {
  ticketData?: Ticket;
}

interface TicketListResponse {
  ticketData?: Ticket[];
  _hasMore?: boolean;
}

export class TicketsApi {
  constructor(private readonly client: ClickBankClient) {}

  /**
   * Get the XML schema for ticket data results
   */
  async getSchema(): Promise<string> {
    return this.client.get<string>('/tickets/schema', undefined, 'xml');
  }

  /**
   * Get the XML schema for partial refund data results
   */
  async getPartialRefundSchema(): Promise<string> {
    return this.client.get<string>('/tickets/partialRefundDataSchema', undefined, 'xml');
  }

  /**
   * Get a ticket by ID
   */
  async get(ticketId: string): Promise<Ticket> {
    const response = await this.client.get<TicketResponse>(`/tickets/${ticketId}`);
    return response.ticketData as Ticket;
  }

  /**
   * Count tickets matching the search criteria
   */
  async count(params?: TicketsCountParams): Promise<number> {
    const response = await this.client.get<{ count: number }>('/tickets/count', params as Record<string, string | number | boolean | undefined>);
    return response.count || 0;
  }

  /**
   * List tickets matching the search criteria
   */
  async list(params?: TicketsListParams): Promise<{ tickets: Ticket[]; hasMore: boolean }> {
    const { page, ...queryParams } = params || {};
    const headers = page ? { page: String(page) } : undefined;

    const response = await this.client.request<TicketListResponse>('/tickets/list', {
      method: 'GET',
      params: queryParams as Record<string, string | number | boolean | undefined>,
      headers,
    });

    const tickets = response.ticketData || [];
    return {
      tickets: Array.isArray(tickets) ? tickets : [tickets],
      hasMore: !!response._hasMore,
    };
  }

  /**
   * Get refund amounts for a receipt
   */
  async getRefundAmounts(receipt: string, params: RefundAmountsParams): Promise<RefundAmountData> {
    return this.client.get<RefundAmountData>(
      `/tickets/refundAmounts/${receipt}`,
      { ...params }
    );
  }

  /**
   * Create a new ticket
   */
  async create(receipt: string, params: CreateTicketParams): Promise<Ticket> {
    const response = await this.client.post<TicketResponse>(
      `/tickets/${receipt}`,
      { ...params }
    );
    return response.ticketData as Ticket;
  }

  /**
   * Update a ticket (close, comment, change type, or reopen)
   */
  async update(ticketId: string, params: UpdateTicketParams): Promise<Ticket> {
    const response = await this.client.put<TicketResponse>(
      `/tickets/${ticketId}`,
      params as Record<string, unknown>
    );
    return response.ticketData as Ticket;
  }

  /**
   * Close a ticket
   */
  async close(ticketId: string, comment?: string): Promise<Ticket> {
    return this.update(ticketId, { action: 'close', comment });
  }

  /**
   * Reopen a ticket
   */
  async reopen(ticketId: string, comment: string): Promise<Ticket> {
    return this.update(ticketId, { action: 'reopen', comment });
  }

  /**
   * Add a comment to a ticket
   */
  async addComment(ticketId: string, comment: string): Promise<Ticket> {
    return this.update(ticketId, { comment });
  }

  /**
   * Acknowledge return of a physical item and complete refund
   */
  async confirmReturn(ticketId: string): Promise<void> {
    await this.client.post(`/tickets/${ticketId}/returned`);
  }

  /**
   * Create a refund ticket
   */
  async createRefund(
    receipt: string,
    refundType: 'FULL' | 'PARTIAL_PERCENT' | 'PARTIAL_AMOUNT',
    reason: string,
    options?: { refundAmount?: number; sku?: string; comment?: string; retainSubscription?: boolean }
  ): Promise<Ticket> {
    return this.create(receipt, {
      type: 'rfnd',
      reason,
      refundType,
      ...options,
    });
  }

  /**
   * Create a cancellation ticket
   */
  async createCancellation(
    receipt: string,
    reason: string,
    options?: { sku?: string; comment?: string }
  ): Promise<Ticket> {
    return this.create(receipt, {
      type: 'cncl',
      reason,
      ...options,
    });
  }

  /**
   * Create a technical support ticket
   */
  async createTechSupport(
    receipt: string,
    reason: string,
    comment?: string
  ): Promise<Ticket> {
    return this.create(receipt, {
      type: 'tech',
      reason,
      comment,
    });
  }
}
