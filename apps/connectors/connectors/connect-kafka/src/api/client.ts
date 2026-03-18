import type { KafkaConfig } from '../types';
import { KafkaApiError } from '../types';

export class KafkaClient {
  private readonly baseUrl: string;
  private readonly authHeader?: string;
  private readonly clusterId: string;

  constructor(config: KafkaConfig) {
    if (!config.url) throw new Error('Kafka REST Proxy url is required');
    this.baseUrl = `${config.url.replace(/\/$/, '')}/v3`;
    this.clusterId = config.clusterId || 'kafka-cluster';
    if (config.username && config.password) {
      this.authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    }
  }

  async request<T>(path: string, options: { method?: string; body?: Record<string, unknown>; params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { method = 'GET', body, params } = options;
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.authHeader) headers.Authorization = this.authHeader;
    const fetchOptions: RequestInit = { method, headers };
    if (body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) fetchOptions.body = JSON.stringify(body);
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 204) return {} as T;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new KafkaApiError((data as { message?: string })?.message || response.statusText, response.status);
    return data as T;
  }

  getClusterId(): string { return this.clusterId; }
}
