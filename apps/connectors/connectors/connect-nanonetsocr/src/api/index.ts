// Nanonets OCR Connector — AI-powered OCR and intelligent document processing
import { NanonetsClient } from './client';
import type { NanonetsConfig, NNModel, NNPrediction, NNFile } from '../types';
export { NanonetsClient } from './client';

export class NanonetsOCR {
  private readonly client: NanonetsClient;
  constructor(config: NanonetsConfig) { this.client = new NanonetsClient(config); }
  static fromEnv(): NanonetsOCR {
    const apiKey = process.env.NANONETS_API_KEY;
    if (!apiKey) throw new Error('NANONETS_API_KEY is required');
    return new NanonetsOCR({ apiKey });
  }

  async listModels(): Promise<NNModel[]> { return this.client.request<NNModel[]>('/OCR/Model/'); }
  async getModel(modelId: string): Promise<NNModel> { return this.client.request<NNModel>(`/OCR/Model/${modelId}`); }

  async predictFromUrl(modelId: string, urls: string[]): Promise<NNPrediction> {
    return this.client.request<NNPrediction>(`/OCR/Model/${modelId}/LabelUrls/`, { method: 'POST', body: { urls } as Record<string, unknown> });
  }

  async getPrediction(modelId: string, fileId: string): Promise<NNPrediction> {
    return this.client.request<NNPrediction>(`/OCR/Model/${modelId}/LabelFile/${fileId}`);
  }

  async listFiles(modelId: string, options?: { page?: number; per_page?: number }): Promise<{ data: NNFile[] }> {
    return this.client.request(`/OCR/Model/${modelId}/FileList/`, { params: { page_number: options?.page, results_per_page: options?.per_page } });
  }

  getClient(): NanonetsClient { return this.client; }
}
