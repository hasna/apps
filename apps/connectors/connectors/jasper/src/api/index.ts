// Jasper Connector — AI content generation and marketing copy
import { JasperClient } from './client';
import type { JasperConfig, JasperTemplate, JasperOutput, JasperCommand, JasperBrand } from '../types';
export { JasperClient } from './client';

export class Jasper {
  private readonly client: JasperClient;
  constructor(config: JasperConfig) { this.client = new JasperClient(config); }
  static fromEnv(): Jasper {
    const apiKey = process.env.JASPER_API_KEY;
    if (!apiKey) throw new Error('JASPER_API_KEY environment variable is required');
    return new Jasper({ apiKey });
  }

  /** Generate content using a command/prompt */
  async generate(command: JasperCommand): Promise<JasperOutput> {
    return this.client.request<JasperOutput>('/commands', { method: 'POST', body: command as Record<string, unknown> });
  }

  /** List available content templates */
  async listTemplates(options?: { limit?: number; offset?: number }): Promise<{ data: JasperTemplate[] }> {
    return this.client.request('/templates', { params: options as Record<string, number | undefined> });
  }

  /** Get a specific template */
  async getTemplate(templateId: string): Promise<JasperTemplate> {
    return this.client.request<JasperTemplate>(`/templates/${templateId}`);
  }

  /** Run a template with inputs */
  async runTemplate(templateId: string, inputs: Record<string, string>, options?: { tone?: string; language?: string; max_length?: number }): Promise<JasperOutput> {
    return this.client.request<JasperOutput>(`/templates/${templateId}/run`, {
      method: 'POST',
      body: { inputs, ...options },
    });
  }

  /** List brand voices */
  async listBrands(): Promise<{ data: JasperBrand[] }> {
    return this.client.request('/brands');
  }

  /** Get a brand voice */
  async getBrand(brandId: string): Promise<JasperBrand> {
    return this.client.request<JasperBrand>(`/brands/${brandId}`);
  }

  getClient(): JasperClient { return this.client; }
}
