import type {
  CiSignal,
  DriftCase,
  FixProposal,
  Project,
  QueryParams,
  RawRequestOptions,
  TapeoutReadiness,
  VisiblSemiconductorsConfig,
} from '../types';
import { encodePathSegment, VisiblSemiconductorsClient } from './client';

export class VisiblSemiconductors {
  private readonly client: VisiblSemiconductorsClient;

  constructor(config: VisiblSemiconductorsConfig) {
    this.client = new VisiblSemiconductorsClient(config);
  }

  static fromEnv(): VisiblSemiconductors {
    const apiKey = process.env.VISIBL_SEMICONDUCTORS_API_KEY;
    const baseUrl = process.env.VISIBL_SEMICONDUCTORS_BASE_URL;

    if (!apiKey) {
      throw new Error('VISIBL_SEMICONDUCTORS_API_KEY environment variable is required');
    }

    return new VisiblSemiconductors({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): VisiblSemiconductorsClient {
    return this.client;
  }

  async listProjects(params?: QueryParams): Promise<Project[]> {
    return this.client.get<Project[]>('/projects', params);
  }

  async getProject(projectId: string): Promise<Project> {
    return this.client.get<Project>(`/projects/${encodePathSegment(projectId)}`);
  }

  async listDriftCases(params?: QueryParams): Promise<DriftCase[]> {
    return this.client.get<DriftCase[]>('/drift-cases', params);
  }

  async getDriftCase(caseId: string): Promise<DriftCase> {
    return this.client.get<DriftCase>(`/drift-cases/${encodePathSegment(caseId)}`);
  }

  async listFixProposals(caseId: string): Promise<FixProposal[]> {
    return this.client.get<FixProposal[]>(
      `/drift-cases/${encodePathSegment(caseId)}/proposals`,
    );
  }

  async approveFixProposal(
    proposalId: string,
    body?: Record<string, unknown>,
  ): Promise<FixProposal> {
    return this.client.post<FixProposal>(
      `/proposals/${encodePathSegment(proposalId)}/approve`,
      body,
    );
  }

  async syncDesignContext(
    projectId: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.client.post(
      `/projects/${encodePathSegment(projectId)}/design-context/sync`,
      body,
    );
  }

  async listCiSignals(params?: QueryParams): Promise<CiSignal[]> {
    return this.client.get<CiSignal[]>('/ci-signals', params);
  }

  async getTapeoutReadiness(projectId: string): Promise<TapeoutReadiness> {
    return this.client.get<TapeoutReadiness>(
      `/projects/${encodePathSegment(projectId)}/tapeout-readiness`,
    );
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { path, method = 'GET', query, body, headers } = options;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }
}

export { VisiblSemiconductorsClient, DEFAULT_BASE_URL, encodePathSegment } from './client';
