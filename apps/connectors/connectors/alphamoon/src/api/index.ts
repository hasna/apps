// Alphamoon Connector — AI document processing and OCR
import { AlphamoonClient } from './client';
import type { AlphamoonConfig, AMDocument, AMDocumentList, AMExtractionResult, AMTemplate, AMProject } from '../types';
export { AlphamoonClient } from './client';

export class Alphamoon {
  private readonly client: AlphamoonClient;
  constructor(config: AlphamoonConfig) { this.client = new AlphamoonClient(config); }
  static fromEnv(): Alphamoon {
    const token = process.env.ALPHAMOON_TOKEN;
    if (!token) throw new Error('ALPHAMOON_TOKEN is required');
    return new Alphamoon({ token });
  }

  async listDocuments(options?: { page?: number; limit?: number; projectId?: string }): Promise<AMDocumentList> {
    return this.client.request<AMDocumentList>('/documents', { params: { page: options?.page, limit: options?.limit, project_id: options?.projectId } });
  }
  async getDocument(documentId: string): Promise<AMDocument> { return this.client.request<AMDocument>(`/documents/${documentId}`); }
  async deleteDocument(documentId: string): Promise<void> { await this.client.request(`/documents/${documentId}`, { method: 'DELETE' }); }

  async getExtractionResults(documentId: string): Promise<AMExtractionResult> {
    return this.client.request<AMExtractionResult>(`/documents/${documentId}/extraction`);
  }

  async listTemplates(): Promise<AMTemplate[]> { return this.client.request<AMTemplate[]>('/templates'); }
  async getTemplate(templateId: string): Promise<AMTemplate> { return this.client.request<AMTemplate>(`/templates/${templateId}`); }
  async createTemplate(data: { name: string; fields: { name: string; type: string }[] }): Promise<AMTemplate> {
    return this.client.request<AMTemplate>('/templates', { method: 'POST', body: data as Record<string, unknown> });
  }
  async deleteTemplate(templateId: string): Promise<void> { await this.client.request(`/templates/${templateId}`, { method: 'DELETE' }); }

  async listProjects(): Promise<AMProject[]> { return this.client.request<AMProject[]>('/projects'); }
  async getProject(projectId: string): Promise<AMProject> { return this.client.request<AMProject>(`/projects/${projectId}`); }
  async createProject(data: { name: string; template_id: string }): Promise<AMProject> {
    return this.client.request<AMProject>('/projects', { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): AlphamoonClient { return this.client; }
}
