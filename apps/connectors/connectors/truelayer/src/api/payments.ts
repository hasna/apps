import type { CreatePaymentRequest, PaymentListParams, TrueLayerPayment } from '../types';
import type { TrueLayerClient } from './client';

export class PaymentsApi {
  constructor(private readonly client: TrueLayerClient) {}

  async listPayments(params?: PaymentListParams): Promise<unknown> {
    return this.client.request('/payments', { params });
  }

  async createPayment(
    data: CreatePaymentRequest,
    headers?: Record<string, string>,
  ): Promise<TrueLayerPayment> {
    return this.client.request<TrueLayerPayment>('/payments', {
      method: 'POST',
      body: data,
      headers,
    });
  }

  async getPayment(paymentId: string): Promise<TrueLayerPayment> {
    return this.client.request<TrueLayerPayment>(`/payments/${encodeURIComponent(paymentId)}`);
  }
}
