// Google BigQuery Connector — Serverless data warehouse and SQL analytics
import { BigQueryClient } from './client';
import type { BigQueryConfig, BQDataset, BQTable, BQQueryResult, BQJob } from '../types';
export { BigQueryClient } from './client';

export class GoogleBigQuery {
  private readonly client: BigQueryClient;
  constructor(config: BigQueryConfig) { this.client = new BigQueryClient(config); }
  static fromEnv(): GoogleBigQuery {
    const projectId = process.env.BIGQUERY_PROJECT_ID;
    const token = process.env.BIGQUERY_TOKEN;
    if (!projectId || !token) throw new Error('BIGQUERY_PROJECT_ID and BIGQUERY_TOKEN are required');
    return new GoogleBigQuery({ projectId, token });
  }

  async query(sql: string, options?: { useLegacySql?: boolean; maxResults?: number; dryRun?: boolean }): Promise<BQQueryResult> {
    return this.client.request<BQQueryResult>(`/projects/${this.client.getProjectId()}/queries`, { method: 'POST', body: { query: sql, useLegacySql: options?.useLegacySql ?? false, maxResults: options?.maxResults, dryRun: options?.dryRun } as Record<string, unknown> });
  }

  async listDatasets(): Promise<{ datasets: BQDataset[] }> {
    return this.client.request(`/projects/${this.client.getProjectId()}/datasets`);
  }
  async getDataset(datasetId: string): Promise<BQDataset> {
    return this.client.request<BQDataset>(`/projects/${this.client.getProjectId()}/datasets/${datasetId}`);
  }

  async listTables(datasetId: string): Promise<{ tables: BQTable[] }> {
    return this.client.request(`/projects/${this.client.getProjectId()}/datasets/${datasetId}/tables`);
  }
  async getTable(datasetId: string, tableId: string): Promise<BQTable> {
    return this.client.request<BQTable>(`/projects/${this.client.getProjectId()}/datasets/${datasetId}/tables/${tableId}`);
  }
  async createTable(datasetId: string, data: { tableReference: { tableId: string }; schema: { fields: { name: string; type: string; mode?: string }[] } }): Promise<BQTable> {
    return this.client.request<BQTable>(`/projects/${this.client.getProjectId()}/datasets/${datasetId}/tables`, { method: 'POST', body: { ...data, tableReference: { ...data.tableReference, datasetId, projectId: this.client.getProjectId() } } as Record<string, unknown> });
  }
  async deleteTable(datasetId: string, tableId: string): Promise<void> {
    await this.client.request(`/projects/${this.client.getProjectId()}/datasets/${datasetId}/tables/${tableId}`, { method: 'DELETE' });
  }

  async getJob(jobId: string): Promise<BQJob> {
    return this.client.request<BQJob>(`/projects/${this.client.getProjectId()}/jobs/${jobId}`);
  }
  async listJobs(options?: { maxResults?: number; stateFilter?: string }): Promise<{ jobs: BQJob[] }> {
    return this.client.request(`/projects/${this.client.getProjectId()}/jobs`, { params: { maxResults: options?.maxResults, stateFilter: options?.stateFilter } });
  }

  getClient(): BigQueryClient { return this.client; }
}
