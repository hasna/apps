import { SpongeClient, compact } from './client';
import type { HyperliquidParams } from '../types';

/**
 * Trading API — Hyperliquid perpetuals/spot access through a single
 * action-dispatched endpoint.
 */
export class TradingApi {
  constructor(private readonly client: SpongeClient) {}

  /** Execute a Hyperliquid action (order, cancel, positions, markets, ...). */
  hyperliquid(params: HyperliquidParams): Promise<unknown> {
    return this.client.post('/api/hyperliquid', compact({ ...params }));
  }
}
