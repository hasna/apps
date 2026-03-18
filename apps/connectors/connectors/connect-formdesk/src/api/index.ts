// Formdesk Connector — Online form builder and data collection
import { FormdeskClient } from './client';
import type { FormdeskConfig, FDForm, FDSubmission, FDSubmissionList } from '../types';
export { FormdeskClient } from './client';

export class Formdesk {
  private readonly client: FormdeskClient;
  constructor(config: FormdeskConfig) { this.client = new FormdeskClient(config); }
  static fromEnv(): Formdesk {
    const apiKey = process.env.FORMDESK_API_KEY;
    const subdomain = process.env.FORMDESK_SUBDOMAIN;
    if (!apiKey || !subdomain) throw new Error('FORMDESK_API_KEY and FORMDESK_SUBDOMAIN are required');
    return new Formdesk({ apiKey, subdomain });
  }

  async listForms(): Promise<FDForm[]> { return this.client.request<FDForm[]>('/forms'); }
  async getForm(formId: string): Promise<FDForm> { return this.client.request<FDForm>(`/forms/${formId}`); }

  async listSubmissions(formId: string, options?: { page?: number; per_page?: number; from_date?: string; to_date?: string }): Promise<FDSubmissionList> {
    return this.client.request<FDSubmissionList>(`/forms/${formId}/submissions`, { params: { page: options?.page, per_page: options?.per_page, from_date: options?.from_date, to_date: options?.to_date } });
  }
  async getSubmission(formId: string, submissionId: string): Promise<FDSubmission> {
    return this.client.request<FDSubmission>(`/forms/${formId}/submissions/${submissionId}`);
  }
  async deleteSubmission(formId: string, submissionId: string): Promise<void> {
    await this.client.request(`/forms/${formId}/submissions/${submissionId}`, { method: 'DELETE' });
  }

  getClient(): FormdeskClient { return this.client; }
}
