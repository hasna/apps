import type { ConnectorClient } from './client';

export interface BalanceAmount {
  amount: number;
  currency: string;
  source_types?: Record<string, number>;
}

export interface Balance {
  object: 'balance';
  available: BalanceAmount[];
  pending: BalanceAmount[];
  livemode: boolean;
}

/**
 * Stripe Balance API
 */
export class BalanceApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Get the current account balance
   */
  async get(): Promise<Balance> {
    return this.client.get<Balance>('/balance');
  }
}
