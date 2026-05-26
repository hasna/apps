// CloudLayer Connector — HTML to PDF and image generation API
import { CloudLayerClient } from './client';
import type { CloudLayerConfig, CLPdfResult, CLImageResult, CLPdfOptions, CLImageOptions, CLUsage } from '../types';
export { CloudLayerClient } from './client';

export class CloudLayer {
  private readonly client: CloudLayerClient;
  constructor(config: CloudLayerConfig) { this.client = new CloudLayerClient(config); }
  static fromEnv(): CloudLayer {
    const apiKey = process.env.CLOUDLAYER_API_KEY;
    if (!apiKey) throw new Error('CLOUDLAYER_API_KEY is required');
    return new CloudLayer({ apiKey });
  }

  async htmlToPdf(options: CLPdfOptions): Promise<CLPdfResult> {
    return this.client.request<CLPdfResult>('/url/pdf', { method: 'POST', body: options as Record<string, unknown> });
  }

  async htmlToImage(options: CLImageOptions): Promise<CLImageResult> {
    return this.client.request<CLImageResult>('/url/image', { method: 'POST', body: options as Record<string, unknown> });
  }

  async templateToPdf(templateId: string, data: Record<string, unknown>, options?: Omit<CLPdfOptions, 'html' | 'url'>): Promise<CLPdfResult> {
    return this.client.request<CLPdfResult>('/template/pdf', { method: 'POST', body: { templateId, data, ...options } as Record<string, unknown> });
  }

  async templateToImage(templateId: string, data: Record<string, unknown>, options?: Omit<CLImageOptions, 'html' | 'url'>): Promise<CLImageResult> {
    return this.client.request<CLImageResult>('/template/image', { method: 'POST', body: { templateId, data, ...options } as Record<string, unknown> });
  }

  async getUsage(): Promise<CLUsage> { return this.client.request<CLUsage>('/usage'); }

  getClient(): CloudLayerClient { return this.client; }
}
