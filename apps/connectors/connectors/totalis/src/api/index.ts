import type { TotalisConfig } from '../types';
import { TotalisClient } from './client';
import { MarketsApi } from './markets';
import { ParlaysApi } from './parlays';
import { QuoteRequestsApi } from './quote-requests';
import { WalletApi } from './wallet';

export class Totalis {
  private readonly client: TotalisClient;
  public readonly markets: MarketsApi;
  public readonly parlays: ParlaysApi;
  public readonly quoteRequests: QuoteRequestsApi;
  public readonly wallet: WalletApi;

  constructor(config: TotalisConfig) {
    this.client = new TotalisClient(config);
    this.markets = new MarketsApi(this.client);
    this.parlays = new ParlaysApi(this.client);
    this.quoteRequests = new QuoteRequestsApi(this.client);
    this.wallet = new WalletApi(this.client);
  }

  static fromEnv(): Totalis {
    const apiKey = process.env.TOTALIS_API_KEY;
    const baseUrl = process.env.TOTALIS_BASE_URL;

    if (!apiKey) {
      throw new Error('TOTALIS_API_KEY environment variable is required');
    }

    return new Totalis({ apiKey, baseUrl });
  }

  getClient(): TotalisClient {
    return this.client;
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { TotalisClient, DEFAULT_BASE_URL } from './client';
