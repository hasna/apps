// Supportive Koala Connector — Automated personalized image generation
import { SupportiveKoalaClient } from './client';
import type { SupportiveKoalaConfig, SKTemplate, SKImage, SKGenerateOptions } from '../types';
export { SupportiveKoalaClient } from './client';

export class SupportiveKoala {
  private readonly client: SupportiveKoalaClient;
  constructor(config: SupportiveKoalaConfig) { this.client = new SupportiveKoalaClient(config); }
  static fromEnv(): SupportiveKoala {
    const apiKey = process.env.SUPPORTIVEKOALA_API_KEY;
    if (!apiKey) throw new Error('SUPPORTIVEKOALA_API_KEY is required');
    return new SupportiveKoala({ apiKey });
  }

  async listTemplates(): Promise<SKTemplate[]> { return this.client.request<SKTemplate[]>('/templates'); }
  async getTemplate(templateId: string): Promise<SKTemplate> { return this.client.request<SKTemplate>(`/templates/${templateId}`); }

  async generateImage(options: SKGenerateOptions): Promise<SKImage> {
    return this.client.request<SKImage>('/images', { method: 'POST', body: options as Record<string, unknown> });
  }

  async getImage(imageId: string): Promise<SKImage> { return this.client.request<SKImage>(`/images/${imageId}`); }
  async listImages(options?: { template_id?: string; page?: number; per_page?: number }): Promise<SKImage[]> {
    return this.client.request<SKImage[]>('/images', { params: { template_id: options?.template_id, page: options?.page, per_page: options?.per_page } });
  }
  async deleteImage(imageId: string): Promise<void> { await this.client.request(`/images/${imageId}`, { method: 'DELETE' }); }

  getClient(): SupportiveKoalaClient { return this.client; }
}
