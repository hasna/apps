// Unifold Connector
// Cross-chain deposit API

import { UnifoldClient } from './client';
import type {
  UnifoldConfig,
  UnifoldUser,
  PaymentIntent,
  TreasuryAccount,
  DepositAddress,
  ListResponse,
  CreatePaymentIntentRequest,
  CreateTreasuryAccountRequest,
  RawRequestOptions,
} from '../types';

export { UnifoldClient } from './client';

export class Unifold {
  private client: UnifoldClient;

  constructor(config: UnifoldConfig) {
    this.client = new UnifoldClient(config);
  }

  // ============================================
  // Users
  // ============================================

  async listUsers(params?: Record<string, string | number | boolean | undefined>): Promise<ListResponse<UnifoldUser> | UnifoldUser[]> {
    return this.client.get('/users', params);
  }

  async getUser(userId: string): Promise<UnifoldUser> {
    const encoded = this.client.encodePathSegment(userId);
    return this.client.get(`/users/${encoded}`);
  }

  // ============================================
  // Payment Intents
  // ============================================

  async listPaymentIntents(params?: Record<string, string | number | boolean | undefined>): Promise<ListResponse<PaymentIntent> | PaymentIntent[]> {
    return this.client.get('/payment-intents', params);
  }

  async getPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const encoded = this.client.encodePathSegment(paymentIntentId);
    return this.client.get(`/payment-intents/${encoded}`);
  }

  async createPaymentIntent(data: CreatePaymentIntentRequest): Promise<PaymentIntent> {
    return this.client.post('/payment-intents', data);
  }

  // ============================================
  // Treasury
  // ============================================

  async createTreasuryAccount(data: CreateTreasuryAccountRequest): Promise<TreasuryAccount> {
    return this.client.post('/treasury/accounts', data);
  }

  async getTreasuryAccount(accountId: string): Promise<TreasuryAccount> {
    const encoded = this.client.encodePathSegment(accountId);
    return this.client.get(`/treasury/accounts/${encoded}`);
  }

  // ============================================
  // Deposit Addresses
  // ============================================

  async listDepositAddresses(params?: Record<string, string | number | boolean | undefined>): Promise<ListResponse<DepositAddress> | DepositAddress[]> {
    return this.client.get('/deposit-addresses', params);
  }

  // ============================================
  // Raw request
  // ============================================

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }
}
