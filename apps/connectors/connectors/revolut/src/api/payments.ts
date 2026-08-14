import type { RevolutPayment, CreatePaymentRequest, CreateTransferRequest } from '../types';
import type { RevolutClient } from './client';

/**
 * Revolut Payments API
 */
export class PaymentsApi {
  constructor(private readonly client: RevolutClient) {}

  /**
   * Create a payment to a counterparty
   */
  async createPayment(data: CreatePaymentRequest): Promise<RevolutPayment> {
    return this.client.request<RevolutPayment>('/pay', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Create an internal transfer between own accounts
   */
  async createTransfer(data: CreateTransferRequest): Promise<RevolutPayment> {
    return this.client.request<RevolutPayment>('/transfer', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Get payment by ID
   */
  async getPayment(paymentId: string): Promise<RevolutPayment> {
    return this.client.request<RevolutPayment>(`/transaction/${paymentId}`);
  }

  /**
   * Get payment by request ID (idempotency key)
   */
  async getPaymentByRequestId(requestId: string): Promise<RevolutPayment> {
    return this.client.request<RevolutPayment>(`/transaction/${requestId}`, {
      params: { id_type: 'request_id' },
    });
  }

  /**
   * Cancel a scheduled payment
   */
  async cancelPayment(paymentId: string): Promise<void> {
    await this.client.request<void>(`/transaction/${paymentId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Schedule a payment for a future date
   */
  async schedulePayment(data: CreatePaymentRequest & { schedule_for: string }): Promise<RevolutPayment> {
    return this.client.request<RevolutPayment>('/pay', {
      method: 'POST',
      body: data,
    });
  }
}
