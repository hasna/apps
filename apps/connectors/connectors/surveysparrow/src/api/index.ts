// SurveySparrow Connector — Conversational survey and feedback platform
import { SurveySparrowClient } from './client';
import type { SurveySparrowConfig, SSSurvey, SSContact, SSSubmission, SSChannel } from '../types';
export { SurveySparrowClient } from './client';

export class SurveySparrow {
  private readonly client: SurveySparrowClient;
  constructor(config: SurveySparrowConfig) { this.client = new SurveySparrowClient(config); }
  static fromEnv(): SurveySparrow {
    const apiKey = process.env.SURVEYSPARROW_API_KEY;
    if (!apiKey) throw new Error('SURVEYSPARROW_API_KEY environment variable is required');
    return new SurveySparrow({ apiKey });
  }

  async listSurveys(options?: { page?: number; limit?: number; status?: string }): Promise<SSSurvey[]> {
    const r = await this.client.request<{ data: SSSurvey[] }>('/surveys', { params: options as Record<string, string | number | undefined> });
    return r.data ?? [];
  }
  async getSurvey(id: number): Promise<SSSurvey> {
    const r = await this.client.request<{ data: SSSurvey }>(`/surveys/${id}`); return r.data;
  }

  async listContacts(options?: { page?: number; limit?: number; email?: string }): Promise<SSContact[]> {
    const r = await this.client.request<{ data: SSContact[] }>('/contacts', { params: options as Record<string, string | number | undefined> });
    return r.data ?? [];
  }
  async createContact(data: { full_name: string; email: string; phone?: string; variables?: Record<string, string> }): Promise<SSContact> {
    const r = await this.client.request<{ data: SSContact }>('/contacts', { method: 'POST', body: data as Record<string, unknown> });
    return r.data;
  }
  async deleteContact(id: number): Promise<void> { await this.client.request(`/contacts/${id}`, { method: 'DELETE' }); }

  async listSubmissions(surveyId: number, options?: { page?: number; limit?: number; from?: string; to?: string }): Promise<SSSubmission[]> {
    const r = await this.client.request<{ data: SSSubmission[] }>(`/surveys/${surveyId}/submissions`, { params: options as Record<string, string | number | undefined> });
    return r.data ?? [];
  }
  async getSubmission(surveyId: number, submissionId: number): Promise<SSSubmission> {
    const r = await this.client.request<{ data: SSSubmission }>(`/surveys/${surveyId}/submissions/${submissionId}`);
    return r.data;
  }

  async listChannels(surveyId: number): Promise<SSChannel[]> {
    const r = await this.client.request<{ data: SSChannel[] }>(`/surveys/${surveyId}/channels`);
    return r.data ?? [];
  }

  getClient(): SurveySparrowClient { return this.client; }
}
