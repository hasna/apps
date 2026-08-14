import type { ConnectorClient } from './client';
import type {
  InboundTransfer,
  InboundTransferCreateParams,
  InboundTransferListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Treasury Inbound Transfers API
 * https://stripe.com/docs/api/treasury/inbound_transfers
 */
export class InboundTransfersApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create an inbound transfer
   */
  async create(params: InboundTransferCreateParams): Promise<InboundTransfer> {
    return this.client.post<InboundTransfer>('/treasury/inbound_transfers', params);
  }

  /**
   * Retrieve an inbound transfer by ID
   */
  async get(id: string): Promise<InboundTransfer> {
    return this.client.get<InboundTransfer>(`/treasury/inbound_transfers/${id}`);
  }

  /**
   * List inbound transfers for a financial account
   */
  async list(options: InboundTransferListOptions): Promise<StripeList<InboundTransfer>> {
    return this.client.get<StripeList<InboundTransfer>>('/treasury/inbound_transfers', options as unknown as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Cancel an inbound transfer
   */
  async cancel(id: string): Promise<InboundTransfer> {
    return this.client.post<InboundTransfer>(`/treasury/inbound_transfers/${id}/cancel`, {});
  }
}
