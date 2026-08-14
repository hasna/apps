import type {
  WithAiConfig,
  Workspace,
  WorkspaceListResponse,
  ResearchTask,
  ResearchTaskCreateInput,
  DocumentSearchInput,
  DocumentSearchResult,
  PortfolioAlertInput,
  PortfolioAlert,
  IntegrationListResponse,
  RawRequestOptions,
  ListParams,
} from '../types';
import { WithAiClient, encodePathSegment } from './client';

export { WithAiClient, ConnectorClient, encodePathSegment, DEFAULT_BASE_URL } from './client';

export class WithAi {
  private readonly client: WithAiClient;

  constructor(config: WithAiConfig) {
    this.client = new WithAiClient(config);
  }

  static fromEnv(): WithAi {
    const apiKey = process.env.WITHAI_API_KEY;
    if (!apiKey) {
      throw new Error('WITHAI_API_KEY environment variable is required');
    }
    return new WithAi({
      apiKey,
      baseUrl: process.env.WITHAI_BASE_URL,
    });
  }

  async listWorkspaces(params?: ListParams): Promise<WorkspaceListResponse> {
    return this.client.get<WorkspaceListResponse>('/workspaces', params);
  }

  async getWorkspace(workspaceId: string): Promise<Workspace> {
    return this.client.get<Workspace>(`/workspaces/${encodePathSegment(workspaceId)}`);
  }

  async createResearchTask(
    workspaceId: string,
    input: ResearchTaskCreateInput = {}
  ): Promise<ResearchTask> {
    return this.client.post<ResearchTask>(
      `/workspaces/${encodePathSegment(workspaceId)}/research-tasks`,
      input
    );
  }

  async getResearchTask(taskId: string): Promise<ResearchTask> {
    return this.client.get<ResearchTask>(`/research-tasks/${encodePathSegment(taskId)}`);
  }

  async searchDocuments(input: DocumentSearchInput = {}): Promise<DocumentSearchResult> {
    return this.client.post<DocumentSearchResult>('/documents/search', input);
  }

  async createPortfolioAlert(input: PortfolioAlertInput = {}): Promise<PortfolioAlert> {
    return this.client.post<PortfolioAlert>('/portfolio/alerts', input);
  }

  async listIntegrations(params?: ListParams): Promise<IntegrationListResponse> {
    return this.client.get<IntegrationListResponse>('/integrations', params);
  }

  async rawRequest(options: RawRequestOptions = {}): Promise<unknown> {
    const path = options.path ?? '/workspaces';
    const method = options.method ?? 'GET';
    return this.client.request(path, {
      method,
      body: options.body,
      params: options.params,
      headers: options.headers,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): WithAiClient {
    return this.client;
  }
}

export { WithAi as Connector };
