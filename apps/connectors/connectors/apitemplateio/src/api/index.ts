// APITemplate.io Connector — PDF and image generation from templates
import { ApiTemplateClient } from './client';
import type { ApiTemplateConfig, ATTemplate, ATTemplateList, ATCreateResult, ATMergeData, ATAccountInfo } from '../types';
export { ApiTemplateClient } from './client';

export class ApiTemplate {
  private readonly client: ApiTemplateClient;
  constructor(config: ApiTemplateConfig) { this.client = new ApiTemplateClient(config); }
  static fromEnv(): ApiTemplate {
    const apiKey = process.env.APITEMPLATE_API_KEY;
    if (!apiKey) throw new Error('APITEMPLATE_API_KEY is required');
    return new ApiTemplate({ apiKey });
  }

  async listTemplates(): Promise<ATTemplateList> { return this.client.request<ATTemplateList>('/list-templates'); }
  async getTemplate(templateId: string): Promise<ATTemplate> { return this.client.request<ATTemplate>(`/get-template`, { params: { template_id: templateId } }); }

  async createPdf(templateId: string, data: ATMergeData, options?: { filename?: string; export_type?: string }): Promise<ATCreateResult> {
    return this.client.request<ATCreateResult>('/create-pdf', { method: 'POST', params: { template_id: templateId }, body: { ...data, ...options } as Record<string, unknown> });
  }

  async createImage(templateId: string, data: ATMergeData, options?: { filename?: string; export_type?: string }): Promise<ATCreateResult> {
    return this.client.request<ATCreateResult>('/create-image', { method: 'POST', params: { template_id: templateId }, body: { ...data, ...options } as Record<string, unknown> });
  }

  async createPdfFromHtml(html: string, options?: { filename?: string; landscape?: boolean; page_size?: string }): Promise<ATCreateResult> {
    return this.client.request<ATCreateResult>('/create-pdf-from-html', { method: 'POST', body: { html, ...options } as Record<string, unknown> });
  }

  async getAccountInfo(): Promise<ATAccountInfo> { return this.client.request<ATAccountInfo>('/account-information'); }

  async deleteObject(transactionRef: string): Promise<void> { await this.client.request('/delete-object', { method: 'GET', params: { transaction_ref: transactionRef } }); }

  getClient(): ApiTemplateClient { return this.client; }
}
