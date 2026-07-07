import type { SpongeConfig } from '../types';
import { SpongeClient } from './client';
import { AgentsApi } from './agents';
import { WalletsApi } from './wallets';
import { TransfersApi } from './transfers';
import { PaymentsApi } from './payments';
import { TradingApi } from './trading';
import { OnrampApi } from './onramp';
import { CardsApi } from './cards';
import { KeysApi } from './keys';
import { RawApi } from './raw';

/**
 * Sponge — PaySponge Agent Wallet API connector.
 *
 * Groups the public REST endpoints into resource APIs: agents, wallets,
 * transfers, payments (x402/MPP), trading (Hyperliquid), fiat onramps, cards,
 * agent service keys, plus a raw escape hatch.
 */
export class Sponge {
  private readonly client: SpongeClient;

  public readonly agents: AgentsApi;
  public readonly wallets: WalletsApi;
  public readonly transfers: TransfersApi;
  public readonly payments: PaymentsApi;
  public readonly trading: TradingApi;
  public readonly onramp: OnrampApi;
  public readonly cards: CardsApi;
  public readonly keys: KeysApi;
  public readonly raw: RawApi;

  constructor(config: SpongeConfig) {
    this.client = new SpongeClient(config);
    this.agents = new AgentsApi(this.client);
    this.wallets = new WalletsApi(this.client);
    this.transfers = new TransfersApi(this.client);
    this.payments = new PaymentsApi(this.client);
    this.trading = new TradingApi(this.client);
    this.onramp = new OnrampApi(this.client);
    this.cards = new CardsApi(this.client);
    this.keys = new KeysApi(this.client);
    this.raw = new RawApi(this.client);
  }

  /**
   * Create a Sponge client from environment variables.
   * Reads SPONGE_API_KEY (required), SPONGE_BASE_URL and SPONGE_VERSION (optional).
   */
  static fromEnv(): Sponge {
    const apiKey = process.env.SPONGE_API_KEY;
    if (!apiKey) {
      throw new Error('SPONGE_API_KEY environment variable is required');
    }
    return new Sponge({
      apiKey,
      baseUrl: process.env.SPONGE_BASE_URL,
      apiVersion: process.env.SPONGE_VERSION,
    });
  }

  /** Get the underlying client for direct/raw API access. */
  getClient(): SpongeClient {
    return this.client;
  }
}

export { SpongeClient } from './client';
export { AgentsApi } from './agents';
export { WalletsApi } from './wallets';
export { TransfersApi } from './transfers';
export { PaymentsApi } from './payments';
export { TradingApi } from './trading';
export { OnrampApi } from './onramp';
export { CardsApi } from './cards';
export { KeysApi } from './keys';
export { RawApi } from './raw';
