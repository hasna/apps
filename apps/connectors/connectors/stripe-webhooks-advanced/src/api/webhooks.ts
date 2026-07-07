import type { ConnectorClient } from './client';
import type {
  WebhookEndpoint,
  WebhookEndpointCreateParams,
  WebhookEndpointUpdateParams,
  WebhookEndpointListOptions,
  StripeList,
  DeletedObject,
} from '../types';

/**
 * Stripe Webhook Endpoints API
 * https://docs.stripe.com/api/webhook_endpoints
 */
export class WebhooksApi {
  constructor(private readonly client: ConnectorClient) {}

  async create(params: WebhookEndpointCreateParams): Promise<WebhookEndpoint> {
    return this.client.post<WebhookEndpoint>('/webhook_endpoints', params as unknown as Record<string, unknown>);
  }

  async get(id: string): Promise<WebhookEndpoint> {
    return this.client.get<WebhookEndpoint>(`/webhook_endpoints/${id}`);
  }

  async update(id: string, params: WebhookEndpointUpdateParams): Promise<WebhookEndpoint> {
    return this.client.post<WebhookEndpoint>(`/webhook_endpoints/${id}`, params as unknown as Record<string, unknown>);
  }

  async list(options?: WebhookEndpointListOptions): Promise<StripeList<WebhookEndpoint>> {
    return this.client.get<StripeList<WebhookEndpoint>>(
      '/webhook_endpoints',
      options as Record<string, string | number | boolean | undefined>,
    );
  }

  async del(id: string): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/webhook_endpoints/${id}`);
  }
}
