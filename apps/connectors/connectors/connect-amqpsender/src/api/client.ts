import type { AMQPSenderConfig } from '../types';
import { AMQPSenderApiError } from '../types';

export class AMQPSenderClient {
  private readonly url: string;
  private readonly defaultExchange: string;
  private readonly defaultRoutingKey: string;
  private readonly managementUrl: string;

  constructor(config: AMQPSenderConfig) {
    if (!config.url) throw new Error('AMQP connection URL is required');
    this.url = config.url;
    this.defaultExchange = config.exchange || '';
    this.defaultRoutingKey = config.routingKey || '';
    // Derive HTTP management API from AMQP URL (RabbitMQ management plugin)
    const parsed = new URL(config.url.replace('amqp://', 'http://').replace('amqps://', 'https://'));
    this.managementUrl = `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.hostname}:15672/api`;
  }

  async managementRequest<T>(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
    const { method = 'GET', body } = options;
    const url = `${this.managementUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url, fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new AMQPSenderApiError((data as { reason?: string })?.reason || response.statusText, response.status);
    return data as T;
  }

  getUrl(): string { return this.url; }
  getDefaultExchange(): string { return this.defaultExchange; }
  getDefaultRoutingKey(): string { return this.defaultRoutingKey; }
}
