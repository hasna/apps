// CraftDraft Connector — Document drafting and template management
import { CraftDraftClient } from './client';
import type { CraftDraftConfig, CDTemplate, CDDocument, CDDocumentList, CDExport } from '../types';
export { CraftDraftClient } from './client';

export class CraftDraft {
  private readonly client: CraftDraftClient;
  constructor(config: CraftDraftConfig) { this.client = new CraftDraftClient(config); }
  static fromEnv(): CraftDraft {
    const apiKey = process.env.CRAFTDRAFT_API_KEY;
    if (!apiKey) throw new Error('CRAFTDRAFT_API_KEY is required');
    return new CraftDraft({ apiKey });
  }

  async listTemplates(): Promise<CDTemplate[]> { return this.client.request<CDTemplate[]>('/templates'); }
  async getTemplate(templateId: string): Promise<CDTemplate> { return this.client.request<CDTemplate>(`/templates/${templateId}`); }

  async listDocuments(options?: { page?: number; per_page?: number; status?: string; template_id?: string }): Promise<CDDocumentList> {
    return this.client.request<CDDocumentList>('/documents', { params: { page: options?.page, per_page: options?.per_page, status: options?.status, template_id: options?.template_id } });
  }
  async getDocument(documentId: string): Promise<CDDocument> { return this.client.request<CDDocument>(`/documents/${documentId}`); }
  async createDocument(data: { template_id: string; name: string; variables: Record<string, string> }): Promise<CDDocument> {
    return this.client.request<CDDocument>('/documents', { method: 'POST', body: data as Record<string, unknown> });
  }
  async updateDocument(documentId: string, data: { name?: string; variables?: Record<string, string>; status?: string }): Promise<CDDocument> {
    return this.client.request<CDDocument>(`/documents/${documentId}`, { method: 'PATCH', body: data as Record<string, unknown> });
  }
  async deleteDocument(documentId: string): Promise<void> { await this.client.request(`/documents/${documentId}`, { method: 'DELETE' }); }

  async exportDocument(documentId: string, format: 'pdf' | 'docx' | 'html'): Promise<CDExport> {
    return this.client.request<CDExport>(`/documents/${documentId}/export`, { method: 'POST', body: { format } });
  }

  getClient(): CraftDraftClient { return this.client; }
}
