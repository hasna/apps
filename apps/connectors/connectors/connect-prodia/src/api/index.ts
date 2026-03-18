// Prodia Connector — Fast AI image generation using Stable Diffusion
import { ProdiaClient } from './client';
import type { ProdiaConfig, ProdiaJob, ProdiaModel, ProdiaGenerateParams, ProdiaTransformParams } from '../types';
export { ProdiaClient } from './client';

export class Prodia {
  private readonly client: ProdiaClient;
  constructor(config: ProdiaConfig) { this.client = new ProdiaClient(config); }
  static fromEnv(): Prodia {
    const apiKey = process.env.PRODIA_API_KEY;
    if (!apiKey) throw new Error('PRODIA_API_KEY is required');
    return new Prodia({ apiKey });
  }

  async generate(params: ProdiaGenerateParams): Promise<ProdiaJob> {
    return this.client.request<ProdiaJob>('/sd/generate', { method: 'POST', body: params as Record<string, unknown> });
  }

  async transform(params: ProdiaTransformParams): Promise<ProdiaJob> {
    return this.client.request<ProdiaJob>('/sd/transform', { method: 'POST', body: params as Record<string, unknown> });
  }

  async generateXL(params: ProdiaGenerateParams): Promise<ProdiaJob> {
    return this.client.request<ProdiaJob>('/sdxl/generate', { method: 'POST', body: params as Record<string, unknown> });
  }

  async getJob(jobId: string): Promise<ProdiaJob> { return this.client.request<ProdiaJob>(`/job/${jobId}`); }

  async listModels(): Promise<string[]> { return this.client.request<string[]>('/sd/models'); }
  async listXLModels(): Promise<string[]> { return this.client.request<string[]>('/sdxl/models'); }
  async listSamplers(): Promise<string[]> { return this.client.request<string[]>('/sd/samplers'); }

  getClient(): ProdiaClient { return this.client; }
}
