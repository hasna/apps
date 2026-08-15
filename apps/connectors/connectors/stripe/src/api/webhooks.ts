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
 * https://stripe.com/docs/api/webhook_endpoints
 */
export class WebhooksApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Create a webhook endpoint
   */
  async create(params: WebhookEndpointCreateParams): Promise<WebhookEndpoint> {
    return this.client.post<WebhookEndpoint>('/webhook_endpoints', params);
  }

  /**
   * Retrieve a webhook endpoint by ID
   */
  async get(id: string): Promise<WebhookEndpoint> {
    return this.client.get<WebhookEndpoint>(`/webhook_endpoints/${id}`);
  }

  /**
   * Update a webhook endpoint
   */
  async update(id: string, params: WebhookEndpointUpdateParams): Promise<WebhookEndpoint> {
    return this.client.post<WebhookEndpoint>(`/webhook_endpoints/${id}`, params);
  }

  /**
   * List all webhook endpoints
   */
  async list(options?: WebhookEndpointListOptions): Promise<StripeList<WebhookEndpoint>> {
    return this.client.get<StripeList<WebhookEndpoint>>('/webhook_endpoints', options as Record<string, string | number | boolean | undefined>);
  }

  /**
   * Delete a webhook endpoint
   */
  async del(id: string): Promise<DeletedObject> {
    return this.client.delete<DeletedObject>(`/webhook_endpoints/${id}`);
  }
}
