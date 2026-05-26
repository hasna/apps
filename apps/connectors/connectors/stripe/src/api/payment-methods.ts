import type { ConnectorClient } from './client';
import type {
  PaymentMethod,
  PaymentMethodCreateParams,
  PaymentMethodUpdateParams,
  PaymentMethodAttachParams,
  PaymentMethodListOptions,
  StripeList,
} from '../types';

/**
 * Stripe Payment Methods API
 * https://stripe.com/docs/api/payment_methods
 */
export class PaymentMethodsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a payment method
   */
  async create(params: PaymentMethodCreateParams): Promise<PaymentMethod> {
    return this.client.post<PaymentMethod>('/payment_methods', params);
  }

  /**
   * Retrieve a payment method by ID
   */
  async get(id: string): Promise<PaymentMethod> {
    return this.client.get<PaymentMethod>(`/payment_methods/${id}`);
  }

  /**
   * Update a payment method
   */
  async update(id: string, params: PaymentMethodUpdateParams): Promise<PaymentMethod> {
    return this.client.post<PaymentMethod>(`/payment_methods/${id}`, params);
  }

  /**
   * List payment methods for a customer
   */
  async list(options: PaymentMethodListOptions): Promise<StripeList<PaymentMethod>> {
    return this.client.get<StripeList<PaymentMethod>>('/payment_methods', options as unknown as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Attach a payment method to a customer
   */
  async attach(id: string, params: PaymentMethodAttachParams): Promise<PaymentMethod> {
    return this.client.post<PaymentMethod>(`/payment_methods/${id}/attach`, params);
  }

  /**
   * Detach a payment method from a customer
   */
  async detach(id: string): Promise<PaymentMethod> {
    return this.client.post<PaymentMethod>(`/payment_methods/${id}/detach`, {});
  }
}
