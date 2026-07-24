import type {
  ZolvoConfig,
  ListLoansOptions,
  ListPaymentsOptions,
  ReconcilePaymentRequest,
  CreateServicingTaskRequest,
  RawRequestOptions,
} from '../types';
import { ZolvoClient } from './client';
import * as loansApi from './loans';
import * as paymentsApi from './payments';
import * as servicingApi from './servicing';

/**
 * Zolvo commercial lending servicing API client.
 */
export class Zolvo {
  private readonly client: ZolvoClient;

  constructor(config: ZolvoConfig) {
    this.client = new ZolvoClient(config);
  }

  static fromEnv(): Zolvo {
    const apiKey = process.env.ZOLVO_API_KEY;
    const baseUrl = process.env.ZOLVO_BASE_URL;

    if (!apiKey) {
      throw new Error('ZOLVO_API_KEY environment variable is required');
    }

    return new Zolvo({ apiKey, baseUrl });
  }

  getClient(): ZolvoClient {
    return this.client;
  }

  async listLoans(options: ListLoansOptions = {}): Promise<Record<string, unknown>> {
    return loansApi.listLoans(this.client, options);
  }

  async getLoan(loanId: string): Promise<Record<string, unknown>> {
    return loansApi.getLoan(this.client, loanId);
  }

  async listPayments(options: ListPaymentsOptions = {}): Promise<Record<string, unknown>> {
    return paymentsApi.listPayments(this.client, options);
  }

  async reconcilePayment(
    paymentId: string,
    body: ReconcilePaymentRequest = {},
  ): Promise<Record<string, unknown>> {
    return paymentsApi.reconcilePayment(this.client, paymentId, body);
  }

  async createServicingTask(
    loanId: string,
    body: CreateServicingTaskRequest = {},
  ): Promise<Record<string, unknown>> {
    return servicingApi.createServicingTask(this.client, loanId, body);
  }

  async rawRequest(options: RawRequestOptions): Promise<Record<string, unknown>> {
    const { path, method = 'GET', query, body, headers } = options;
    const params = query as Record<string, string | number | boolean | undefined> | undefined;
    return this.client.request<Record<string, unknown>>(path, {
      method,
      params,
      body,
      headers,
    });
  }
}

export { ZolvoClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
