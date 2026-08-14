import { WatoClient } from './client';
import type {
  WatoArtifact,
  WatoConfig,
  WatoMemory,
  WatoMemoryList,
  WatoToolList,
  WatoWorkflowList,
  WatoWorkflowRun,
} from '../types';

export { WatoClient, DEFAULT_BASE_URL } from './client';

export class Wato {
  private readonly client: WatoClient;

  constructor(config: WatoConfig) {
    this.client = new WatoClient(config);
  }

  static fromEnv(): Wato {
    const apiKey = process.env.WATO_API_KEY;
    if (!apiKey) throw new Error('WATO_API_KEY is required');
    return new Wato({
      apiKey,
      baseUrl: process.env.WATO_BASE_URL,
    });
  }

  async listMemories(params?: Record<string, string | number | boolean | undefined>): Promise<WatoMemoryList> {
    return this.client.request<WatoMemoryList>('/memories', { params });
  }

  async upsertMemory(body: Record<string, unknown>): Promise<WatoMemory> {
    return this.client.request<WatoMemory>('/memories', { method: 'POST', body });
  }

  async getMemory(memoryId: string): Promise<WatoMemory> {
    const encoded = this.client.encodePathSegment(memoryId);
    return this.client.request<WatoMemory>(`/memories/${encoded}`);
  }

  async listWorkflows(params?: Record<string, string | number | boolean | undefined>): Promise<WatoWorkflowList> {
    return this.client.request<WatoWorkflowList>('/workflows', { params });
  }

  async runWorkflow(workflowId: string, body: Record<string, unknown> = {}): Promise<WatoWorkflowRun> {
    const encoded = this.client.encodePathSegment(workflowId);
    return this.client.request<WatoWorkflowRun>(`/workflows/${encoded}/runs`, { method: 'POST', body });
  }

  async listTools(params?: Record<string, string | number | boolean | undefined>): Promise<WatoToolList> {
    return this.client.request<WatoToolList>('/tools', { params });
  }

  async getArtifact(artifactId: string): Promise<WatoArtifact> {
    const encoded = this.client.encodePathSegment(artifactId);
    return this.client.request<WatoArtifact>(`/artifacts/${encoded}`);
  }

  async rawRequest(
    path: string,
    options: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
      headers?: Record<string, string>;
    } = {},
  ): Promise<unknown> {
    return this.client.request(path, options);
  }

  getClient(): WatoClient {
    return this.client;
  }
}
