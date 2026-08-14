// Azure Cosmos DB Connector — Globally distributed multi-model database
import { AzureCosmosDBClient } from './client';
import type { AzureCosmosDBConfig, CosmosDatabase, CosmosDatabaseList, CosmosContainer, CosmosContainerList, CosmosDocument, CosmosQueryResult } from '../types';
export { AzureCosmosDBClient } from './client';

export class AzureCosmosDB {
  private readonly client: AzureCosmosDBClient;
  constructor(config: AzureCosmosDBConfig) { this.client = new AzureCosmosDBClient(config); }
  static fromEnv(): AzureCosmosDB {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;
    if (!endpoint || !key) throw new Error('COSMOS_ENDPOINT and COSMOS_KEY are required');
    return new AzureCosmosDB({ endpoint, key });
  }

  async listDatabases(): Promise<CosmosDatabaseList> {
    return this.client.request<CosmosDatabaseList>('/dbs', { resourceType: 'dbs', resourceLink: '' });
  }
  async getDatabase(dbId: string): Promise<CosmosDatabase> {
    return this.client.request<CosmosDatabase>(`/dbs/${dbId}`, { resourceType: 'dbs', resourceLink: `dbs/${dbId}` });
  }
  async createDatabase(id: string): Promise<CosmosDatabase> {
    return this.client.request<CosmosDatabase>('/dbs', { method: 'POST', resourceType: 'dbs', resourceLink: '', body: { id } });
  }
  async deleteDatabase(dbId: string): Promise<void> {
    await this.client.request(`/dbs/${dbId}`, { method: 'DELETE', resourceType: 'dbs', resourceLink: `dbs/${dbId}` });
  }

  async listContainers(dbId: string): Promise<CosmosContainerList> {
    return this.client.request<CosmosContainerList>(`/dbs/${dbId}/colls`, { resourceType: 'colls', resourceLink: `dbs/${dbId}` });
  }
  async createContainer(dbId: string, id: string, partitionKey: string): Promise<CosmosContainer> {
    return this.client.request<CosmosContainer>(`/dbs/${dbId}/colls`, { method: 'POST', resourceType: 'colls', resourceLink: `dbs/${dbId}`, body: { id, partitionKey: { paths: [partitionKey], kind: 'Hash' } } });
  }

  async queryDocuments(dbId: string, containerId: string, query: string, parameters?: { name: string; value: unknown }[]): Promise<CosmosQueryResult> {
    return this.client.request<CosmosQueryResult>(`/dbs/${dbId}/colls/${containerId}/docs`, { method: 'POST', resourceType: 'docs', resourceLink: `dbs/${dbId}/colls/${containerId}`, body: { query, parameters: parameters || [] } });
  }
  async getDocument(dbId: string, containerId: string, docId: string): Promise<CosmosDocument> {
    return this.client.request<CosmosDocument>(`/dbs/${dbId}/colls/${containerId}/docs/${docId}`, { resourceType: 'docs', resourceLink: `dbs/${dbId}/colls/${containerId}/docs/${docId}` });
  }
  async createDocument(dbId: string, containerId: string, doc: Record<string, unknown>): Promise<CosmosDocument> {
    return this.client.request<CosmosDocument>(`/dbs/${dbId}/colls/${containerId}/docs`, { method: 'POST', resourceType: 'docs', resourceLink: `dbs/${dbId}/colls/${containerId}`, body: doc });
  }
  async deleteDocument(dbId: string, containerId: string, docId: string): Promise<void> {
    await this.client.request(`/dbs/${dbId}/colls/${containerId}/docs/${docId}`, { method: 'DELETE', resourceType: 'docs', resourceLink: `dbs/${dbId}/colls/${containerId}/docs/${docId}` });
  }

  getClient(): AzureCosmosDBClient { return this.client; }
}
