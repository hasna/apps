import type { ConnectorClient } from './client';
import type {
  TerminalReader,
  TerminalReaderCreateParams,
  TerminalReaderUpdateParams,
  TerminalReaderListOptions,
  ProcessPaymentIntentParams,
  ProcessSetupIntentParams,
  ProcessRefundParams,
  StripeList,
  DeletedObject,
} from '../types';

/**
 * Stripe Terminal Readers API
 * https://stripe.com/docs/api/terminal/readers
 */
export class ReadersApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params: TerminalReaderCreateParams): Promise<TerminalReader> {
    return this.client.post<TerminalReader>('/terminal/readers', params);
  }

  async get(id: string): Promise<TerminalReader> {
    return this.client.get<TerminalReader>(`/terminal/readers/${id}`);
  }

  async update(id: string, params: TerminalReaderUpdateParams): Promise<TerminalReader> {
    return this.client.post<TerminalReader>(`/terminal/readers/${id}`, params);
  }

  async list(options?: TerminalReaderListOptions): Promise<StripeList<TerminalReader>> {
    return this.client.get<StripeList<TerminalReader>>('/terminal/readers', options as Record<string, string | number | boolean | undefined>);
  }

  async del(id: string): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/terminal/readers/${id}`);
  }

  async processPaymentIntent(id: string, params: ProcessPaymentIntentParams): Promise<TerminalReader> {
    return this.client.post<TerminalReader>(`/terminal/readers/${id}/process_payment_intent`, params);
  }

  async processSetupIntent(id: string, params: ProcessSetupIntentParams): Promise<TerminalReader> {
    return this.client.post<TerminalReader>(`/terminal/readers/${id}/process_setup_intent`, params);
  }

  async processRefund(id: string, params: ProcessRefundParams): Promise<TerminalReader> {
    return this.client.post<TerminalReader>(`/terminal/readers/${id}/process_refund`, params);
  }

  async cancelAction(id: string): Promise<TerminalReader> {
    return this.client.post<TerminalReader>(`/terminal/readers/${id}/cancel_action`, {});
  }
}
