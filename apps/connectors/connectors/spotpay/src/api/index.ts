import type { SpotPayConfig, SpotPayJson } from '../types';
import { SpotPayClient, type SpotPayRequestOptions } from './client';

/**
 * SpotPay API connector — global stablecoin neobank
 */
export class SpotPay {
  private readonly client: SpotPayClient;

  constructor(config: SpotPayConfig) {
    this.client = new SpotPayClient(config);
  }

  static fromEnv(): SpotPay {
    const apiKey = process.env.SPOTPAY_API_KEY;
    const baseUrl = process.env.SPOTPAY_BASE_URL;

    if (!apiKey) {
      throw new Error('SPOTPAY_API_KEY environment variable is required');
    }

    return new SpotPay({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): SpotPayClient {
    return this.client;
  }

  async getAccount(): Promise<SpotPayJson> {
    return this.client.get<SpotPayJson>('/account');
  }

  async listTransactions(params?: Record<string, string | number | boolean | undefined>): Promise<SpotPayJson> {
    return this.client.get<SpotPayJson>('/transactions', params);
  }

  async createTransfer(body: Record<string, unknown>): Promise<SpotPayJson> {
    return this.client.post<SpotPayJson>('/transfers', body);
  }

  async createPayment(body: Record<string, unknown>): Promise<SpotPayJson> {
    return this.client.post<SpotPayJson>('/payments', body);
  }

  async listCards(params?: Record<string, string | number | boolean | undefined>): Promise<SpotPayJson> {
    return this.client.get<SpotPayJson>('/cards', params);
  }

  async getExchangeRate(params?: Record<string, string | number | boolean | undefined>): Promise<SpotPayJson> {
    return this.client.get<SpotPayJson>('/exchange-rates', params);
  }

  async rawRequest(path: string, options: SpotPayRequestOptions = {}): Promise<SpotPayJson> {
    return this.client.request<SpotPayJson>(path, options);
  }
}

export { SpotPayClient, DEFAULT_BASE_URL } from './client';
export type { SpotPayRequestOptions } from './client';
