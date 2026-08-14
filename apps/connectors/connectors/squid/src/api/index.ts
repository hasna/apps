import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { NetworkModelsApi } from './network-models';
import { AssetsApi } from './assets';
import { WorkflowsApi } from './workflows';
import { WorkflowRunsApi } from './workflow-runs';
import { RawApi } from './raw';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly networkModels: NetworkModelsApi;
  public readonly assets: AssetsApi;
  public readonly workflows: WorkflowsApi;
  public readonly workflowRuns: WorkflowRunsApi;
  public readonly raw: RawApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.networkModels = new NetworkModelsApi(this.client);
    this.assets = new AssetsApi(this.client);
    this.workflows = new WorkflowsApi(this.client);
    this.workflowRuns = new WorkflowRunsApi(this.client);
    this.raw = new RawApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.SQUID_API_KEY;
    if (!apiKey) {
      throw new Error('SQUID_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      baseUrl: process.env.SQUID_BASE_URL,
    });
  }

  listNetworkModels(...args: Parameters<NetworkModelsApi['list']>) {
    return this.networkModels.list(...args);
  }

  getNetworkModel(modelId: string) {
    return this.networkModels.get(modelId);
  }

  listModelVersions(modelId: string, params?: Parameters<NetworkModelsApi['listVersions']>[1]) {
    return this.networkModels.listVersions(modelId, params);
  }

  listAssets(...args: Parameters<AssetsApi['list']>) {
    return this.assets.list(...args);
  }

  listWorkflows(...args: Parameters<WorkflowsApi['list']>) {
    return this.workflows.list(...args);
  }

  createWorkflowRun(params: Parameters<WorkflowRunsApi['create']>[0]) {
    return this.workflowRuns.create(params);
  }

  rawRequest<T = unknown>(params: Parameters<RawApi['request']>[0]) {
    return this.raw.request<T>(params);
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { NetworkModelsApi } from './network-models';
export { AssetsApi } from './assets';
export { WorkflowsApi } from './workflows';
export { WorkflowRunsApi } from './workflow-runs';
export { RawApi } from './raw';
