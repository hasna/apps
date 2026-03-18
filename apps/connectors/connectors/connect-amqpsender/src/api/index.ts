// AMQP Sender Connector — AMQP message queue producer (RabbitMQ compatible)
import { AMQPSenderClient } from './client';
import type { AMQPSenderConfig, AMQPExchange, AMQPQueue, AMQPConnectionInfo } from '../types';
export { AMQPSenderClient } from './client';

export class AMQPSender {
  private readonly client: AMQPSenderClient;
  constructor(config: AMQPSenderConfig) { this.client = new AMQPSenderClient(config); }
  static fromEnv(): AMQPSender {
    const url = process.env.AMQP_URL;
    if (!url) throw new Error('AMQP_URL is required');
    return new AMQPSender({ url, exchange: process.env.AMQP_EXCHANGE, routingKey: process.env.AMQP_ROUTING_KEY });
  }

  // Management API (RabbitMQ HTTP API)
  async listExchanges(vhost?: string): Promise<AMQPExchange[]> {
    return this.client.managementRequest<AMQPExchange[]>(`/exchanges/${encodeURIComponent(vhost || '/')}`);
  }
  async getExchange(name: string, vhost?: string): Promise<AMQPExchange> {
    return this.client.managementRequest<AMQPExchange>(`/exchanges/${encodeURIComponent(vhost || '/')}/${encodeURIComponent(name)}`);
  }

  async listQueues(vhost?: string): Promise<AMQPQueue[]> {
    return this.client.managementRequest<AMQPQueue[]>(`/queues/${encodeURIComponent(vhost || '/')}`);
  }
  async getQueue(name: string, vhost?: string): Promise<AMQPQueue> {
    return this.client.managementRequest<AMQPQueue>(`/queues/${encodeURIComponent(vhost || '/')}/${encodeURIComponent(name)}`);
  }
  async purgeQueue(name: string, vhost?: string): Promise<void> {
    await this.client.managementRequest(`/queues/${encodeURIComponent(vhost || '/')}/${encodeURIComponent(name)}/contents`, { method: 'DELETE' });
  }

  async publishToQueue(queue: string, message: string, vhost?: string): Promise<void> {
    await this.client.managementRequest(`/exchanges/${encodeURIComponent(vhost || '/')}/%2F/publish`, {
      method: 'POST', body: { routing_key: queue, payload: message, payload_encoding: 'string', properties: {} }
    });
  }

  async getOverview(): Promise<AMQPConnectionInfo & Record<string, unknown>> {
    return this.client.managementRequest('/overview');
  }

  getClient(): AMQPSenderClient { return this.client; }
}
