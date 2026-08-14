import type { ConnectorClient } from './client';
import type {
  OutboundTransfer,
  OutboundTransferCreateParams,
  OutboundTransferListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Treasury Outbound Transfers API
 * https://stripe.com/docs/api/treasury/outbound_transfers
 */
export class OutboundTransfersApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create an outbound transfer
   */
  async create(params: OutboundTransferCreateParams): Promise<OutboundTransfer> {
    return this.client.post<OutboundTransfer>('/treasury/outbound_transfers', params);
  }

  /**
   * Retrieve an outbound transfer by ID
   */
  async get(id: string): Promise<OutboundTransfer> {
    return this.client.get<OutboundTransfer>(`/treasury/outbound_transfers/${id}`);
  }

  /**
   * List outbound transfers for a financial account
   */
  async list(options: OutboundTransferListOptions): Promise<StripeList<OutboundTransfer>> {
    return this.client.get<StripeList<OutboundTransfer>>('/treasury/outbound_transfers', options as unknown as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Cancel an outbound transfer
   */
  async cancel(id: string): Promise<OutboundTransfer> {
    return this.client.post<OutboundTransfer>(`/treasury/outbound_transfers/${id}/cancel`, {});
  }
}
