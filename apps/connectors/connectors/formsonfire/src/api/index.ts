// Forms On Fire Connector — Mobile forms and data collection
import { FormsOnFireClient } from './client';
import type { FormsOnFireConfig, FOFForm, FOFSubmission, FOFSubmissionList, FOFUser } from '../types';
export { FormsOnFireClient } from './client';

export class FormsOnFire {
  private readonly client: FormsOnFireClient;
  constructor(config: FormsOnFireConfig) { this.client = new FormsOnFireClient(config); }
  static fromEnv(): FormsOnFire {
    const apiKey = process.env.FORMSONFIRE_API_KEY;
    if (!apiKey) throw new Error('FORMSONFIRE_API_KEY is required');
    return new FormsOnFire({ apiKey });
  }

  async listForms(): Promise<FOFForm[]> { return this.client.request<FOFForm[]>('/forms'); }
  async getForm(formId: string): Promise<FOFForm> { return this.client.request<FOFForm>(`/forms/${formId}`); }

  async listSubmissions(formId: string, options?: { page?: number; per_page?: number; status?: string }): Promise<FOFSubmissionList> {
    return this.client.request<FOFSubmissionList>(`/forms/${formId}/submissions`, { params: { page: options?.page, per_page: options?.per_page, status: options?.status } });
  }
  async getSubmission(formId: string, submissionId: string): Promise<FOFSubmission> {
    return this.client.request<FOFSubmission>(`/forms/${formId}/submissions/${submissionId}`);
  }

  async listUsers(): Promise<FOFUser[]> { return this.client.request<FOFUser[]>('/users'); }

  getClient(): FormsOnFireClient { return this.client; }
}
