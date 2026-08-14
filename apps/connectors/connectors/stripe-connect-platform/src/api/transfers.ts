import type { ConnectorClient } from './client';
import type {
  StripeList,
  Transfer,
  TransferCreateParams,
  TransferListOptions,
  TransferReversal,
} from '../types';

/**
 * Stripe Connect Transfers API
 * https://docs.stripe.com/api/transfers
 */
export class TransfersApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params: TransferCreateParams): Promise<Transfer> {
    return this.client.post<Transfer>('/transfers', params);
  }

  async get(id: string): Promise<Transfer> {
    return this.client.get<Transfer>(`/transfers/${id}`);
  }

  async list(options?: TransferListOptions): Promise<StripeList<Transfer>> {
    return this.client.get<StripeList<Transfer>>(
      '/transfers',
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  async createReversal(transferId: string, params?: { amount?: number; description?: string; metadata?: Record<string, string> }): Promise<TransferReversal> {
    return this.client.post<TransferReversal>(`/transfers/${transferId}/reversals`, params || {});
  }
}
