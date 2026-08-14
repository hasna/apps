import { SpongeClient } from './client';
import type { BalancesOptions } from '../types';

/**
 * Wallet API — inspect wallets and token balances.
 */
export class WalletsApi {
  constructor(private readonly client: SpongeClient) {}

  /** Get aggregated balances for the authenticated agent. */
  balances(options: BalancesOptions = {}): Promise<unknown> {
    return this.client.get('/api/balances', {
      chain: options.chain,
      allowedChains: options.allowedChains,
      onlyUsdc: options.onlyUsdc,
    });
  }

  /** List wallets. */
  list(options: { includeBalances?: boolean } = {}): Promise<unknown> {
    return this.client.get('/api/wallets/', {
      includeBalances: options.includeBalances,
    });
  }

  /** Get a wallet by id. */
  get(id: string): Promise<unknown> {
    return this.client.get(`/api/wallets/${encodeURIComponent(id)}`);
  }

  /** Get a wallet's balance, optionally scoped to a chain. */
  balance(id: string, options: { chainId?: string } = {}): Promise<unknown> {
    return this.client.get(`/api/wallets/${encodeURIComponent(id)}/balance`, {
      chainId: options.chainId,
    });
  }
}
