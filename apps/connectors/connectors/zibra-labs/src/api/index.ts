import type {
  ZibraLabsConfig,
  Cluster,
  BacktestJob,
  Dataset,
  RawRequestOptions,
} from '../types';
import { ZibraLabsClient, encodePathSegment } from './client';

export class ZibraLabs {
  private readonly client: ZibraLabsClient;

  constructor(config: ZibraLabsConfig) {
    this.client = new ZibraLabsClient(config);
  }

  static fromEnv(): ZibraLabs {
    const apiKey = process.env.ZIBRA_LABS_API_KEY || process.env.CONNECTOR_API_KEY;
    if (!apiKey) {
      throw new Error('ZIBRA_LABS_API_KEY environment variable is required');
    }
    return new ZibraLabs({
      apiKey,
      baseUrl: process.env.ZIBRA_LABS_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async listClusters(params?: Record<string, string | number | boolean | undefined>): Promise<Cluster[] | { clusters: Cluster[] }> {
    return this.client.get('/clusters', params);
  }

  async getCluster(clusterId: string): Promise<Cluster> {
    return this.client.get(`/clusters/${encodePathSegment(clusterId)}`);
  }

  async submitBacktest(body: Record<string, unknown>): Promise<BacktestJob> {
    return this.client.post('/backtests', body);
  }

  async getBacktest(jobId: string): Promise<BacktestJob> {
    return this.client.get(`/backtests/${encodePathSegment(jobId)}`);
  }

  async cancelBacktest(jobId: string, body?: Record<string, unknown>): Promise<BacktestJob | Record<string, unknown>> {
    return this.client.post(`/backtests/${encodePathSegment(jobId)}/cancel`, body);
  }

  async listDatasets(params?: Record<string, string | number | boolean | undefined>): Promise<Dataset[] | { datasets: Dataset[] }> {
    return this.client.get('/datasets', params);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, params, body, headers } = options;
    return this.client.request<T>(path, { method, params, body, headers });
  }

  getClient(): ZibraLabsClient {
    return this.client;
  }
}

export { ZibraLabsClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
