// Formcarry Connector — Form backend for static sites and apps
import { FormcarryClient } from './client';
import type { FormcarryConfig, FCForm, FCSubmission } from '../types';
export { FormcarryClient } from './client';

export class Formcarry {
  private readonly client: FormcarryClient;
  constructor(config: FormcarryConfig) { this.client = new FormcarryClient(config); }
  static fromEnv(): Formcarry {
    const apiKey = process.env.FORMCARRY_API_KEY;
    if (!apiKey) throw new Error('FORMCARRY_API_KEY environment variable is required');
    return new Formcarry({ apiKey });
  }
  async listForms(): Promise<FCForm[]> { const r = await this.client.request<{ data: FCForm[] }>('/forms'); return r.data ?? []; }
  async getForm(formId: string): Promise<FCForm> { const r = await this.client.request<{ data: FCForm }>(`/forms/${formId}`); return r.data; }
  async listSubmissions(formId: string, options?: { page?: number; limit?: number; archived?: boolean; spam?: boolean }): Promise<FCSubmission[]> {
    const r = await this.client.request<{ data: FCSubmission[] }>(`/forms/${formId}/submissions`, { params: options as Record<string, string | number | undefined> });
    return r.data ?? [];
  }
  async getSubmission(formId: string, submissionId: string): Promise<FCSubmission> {
    const r = await this.client.request<{ data: FCSubmission }>(`/forms/${formId}/submissions/${submissionId}`); return r.data;
  }
  async archiveSubmission(formId: string, submissionId: string): Promise<void> {
    await this.client.request(`/forms/${formId}/submissions/${submissionId}`, { method: 'PATCH', body: { archived: true } });
  }
  async deleteSubmission(formId: string, submissionId: string): Promise<void> {
    await this.client.request(`/forms/${formId}/submissions/${submissionId}`, { method: 'DELETE' });
  }
  getClient(): FormcarryClient { return this.client; }
}
