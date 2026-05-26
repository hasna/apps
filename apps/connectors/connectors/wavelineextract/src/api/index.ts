// Waveline Extract Connector — Document data extraction and parsing
import { WavelineClient } from './client';
import type { WavelineConfig, WLExtraction, WLTemplate } from '../types';
export { WavelineClient } from './client';

export class WavelineExtract {
  private readonly client: WavelineClient;
  constructor(config: WavelineConfig) { this.client = new WavelineClient(config); }
  static fromEnv(): WavelineExtract {
    const apiKey = process.env.WAVELINE_API_KEY;
    if (!apiKey) throw new Error('WAVELINE_API_KEY is required');
    return new WavelineExtract({ apiKey });
  }

  async extractFromUrl(documentUrl: string, templateId?: string): Promise<WLExtraction> {
    return this.client.request<WLExtraction>('/extract', { method: 'POST', body: { document_url: documentUrl, template_id: templateId } as Record<string, unknown> });
  }
  async getExtraction(extractionId: string): Promise<WLExtraction> { return this.client.request<WLExtraction>(`/extractions/${extractionId}`); }
  async listExtractions(options?: { page?: number; status?: string }): Promise<{ extractions: WLExtraction[]; total: number }> {
    return this.client.request('/extractions', { params: { page: options?.page, status: options?.status } });
  }

  async listTemplates(): Promise<WLTemplate[]> { return this.client.request<WLTemplate[]>('/templates'); }
  async getTemplate(templateId: string): Promise<WLTemplate> { return this.client.request<WLTemplate>(`/templates/${templateId}`); }

  getClient(): WavelineClient { return this.client; }
}
