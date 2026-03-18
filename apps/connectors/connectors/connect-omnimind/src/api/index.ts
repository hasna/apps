// OmniMind Connector — No-code AI assistant builder with custom knowledge bases
import { OmniMindClient } from './client';
import type { OmniMindConfig, OMProject, OMDataSource, OMQueryResult, OMWidget } from '../types';
export { OmniMindClient } from './client';

export class OmniMind {
  private readonly client: OmniMindClient;
  constructor(config: OmniMindConfig) { this.client = new OmniMindClient(config); }
  static fromEnv(): OmniMind {
    const apiKey = process.env.OMNIMIND_API_KEY;
    if (!apiKey) throw new Error('OMNIMIND_API_KEY is required');
    return new OmniMind({ apiKey });
  }

  async listProjects(): Promise<OMProject[]> { return this.client.request<OMProject[]>('/projects'); }
  async getProject(projectId: string): Promise<OMProject> { return this.client.request<OMProject>(`/projects/${projectId}`); }
  async createProject(data: { name: string; description?: string; model?: string }): Promise<OMProject> {
    return this.client.request<OMProject>('/projects', { method: 'POST', body: data as Record<string, unknown> });
  }

  async query(projectId: string, question: string, options?: { max_sources?: number }): Promise<OMQueryResult> {
    return this.client.request<OMQueryResult>(`/projects/${projectId}/query`, { method: 'POST', body: { question, max_sources: options?.max_sources } as Record<string, unknown> });
  }

  async listDataSources(projectId: string): Promise<OMDataSource[]> { return this.client.request<OMDataSource[]>(`/projects/${projectId}/data-sources`); }
  async addUrlSource(projectId: string, url: string): Promise<OMDataSource> {
    return this.client.request<OMDataSource>(`/projects/${projectId}/data-sources`, { method: 'POST', body: { type: 'url', url } });
  }
  async addTextSource(projectId: string, name: string, content: string): Promise<OMDataSource> {
    return this.client.request<OMDataSource>(`/projects/${projectId}/data-sources`, { method: 'POST', body: { type: 'text', name, content } });
  }
  async deleteDataSource(projectId: string, dataSourceId: string): Promise<void> {
    await this.client.request(`/projects/${projectId}/data-sources/${dataSourceId}`, { method: 'DELETE' });
  }

  async listWidgets(projectId: string): Promise<OMWidget[]> { return this.client.request<OMWidget[]>(`/projects/${projectId}/widgets`); }

  getClient(): OmniMindClient { return this.client; }
}
