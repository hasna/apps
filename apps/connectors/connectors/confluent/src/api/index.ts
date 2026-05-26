// Confluent Connector — Cloud-native Apache Kafka streaming platform
import { ConfluentClient } from './client';
import type { ConfluentConfig, CFEnvironment, CFCluster, CFConnector, CFServiceAccount, CFApiKey } from '../types';
export { ConfluentClient } from './client';

export class Confluent {
  private readonly client: ConfluentClient;
  constructor(config: ConfluentConfig) { this.client = new ConfluentClient(config); }
  static fromEnv(): Confluent {
    const apiKey = process.env.CONFLUENT_API_KEY;
    const apiSecret = process.env.CONFLUENT_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error('CONFLUENT_API_KEY and CONFLUENT_API_SECRET are required');
    return new Confluent({ apiKey, apiSecret });
  }

  async listEnvironments(): Promise<{ data: CFEnvironment[] }> { return this.client.request('/org/v2/environments'); }
  async getEnvironment(envId: string): Promise<CFEnvironment> { return this.client.request<CFEnvironment>(`/org/v2/environments/${envId}`); }

  async listClusters(environmentId: string): Promise<{ data: CFCluster[] }> {
    return this.client.request('/cmk/v2/clusters', { params: { environment: environmentId } });
  }
  async getCluster(clusterId: string, environmentId: string): Promise<CFCluster> {
    return this.client.request<CFCluster>(`/cmk/v2/clusters/${clusterId}`, { params: { environment: environmentId } });
  }

  async listConnectors(environmentId: string, clusterId: string): Promise<{ data: CFConnector[] }> {
    return this.client.request(`/connect/v1/environments/${environmentId}/clusters/${clusterId}/connectors`);
  }
  async getConnector(environmentId: string, clusterId: string, connectorName: string): Promise<CFConnector> {
    return this.client.request<CFConnector>(`/connect/v1/environments/${environmentId}/clusters/${clusterId}/connectors/${connectorName}`);
  }
  async createConnector(environmentId: string, clusterId: string, config: Record<string, string>): Promise<CFConnector> {
    return this.client.request<CFConnector>(`/connect/v1/environments/${environmentId}/clusters/${clusterId}/connectors`, { method: 'POST', body: { name: config.name, config } as Record<string, unknown> });
  }
  async deleteConnector(environmentId: string, clusterId: string, connectorName: string): Promise<void> {
    await this.client.request(`/connect/v1/environments/${environmentId}/clusters/${clusterId}/connectors/${connectorName}`, { method: 'DELETE' });
  }

  async listServiceAccounts(): Promise<{ data: CFServiceAccount[] }> { return this.client.request('/iam/v2/service-accounts'); }

  async listApiKeys(): Promise<{ data: CFApiKey[] }> { return this.client.request('/iam/v2/api-keys'); }

  getClient(): ConfluentClient { return this.client; }
}
