// TurboHire Connector — AI-powered recruitment and applicant tracking
import { TurboHireClient } from './client';
import type { TurboHireConfig, THJob, THCandidate, THCandidateList, THStage, THInterview } from '../types';
export { TurboHireClient } from './client';

export class TurboHire {
  private readonly client: TurboHireClient;
  constructor(config: TurboHireConfig) { this.client = new TurboHireClient(config); }
  static fromEnv(): TurboHire {
    const apiKey = process.env.TURBOHIRE_API_KEY;
    if (!apiKey) throw new Error('TURBOHIRE_API_KEY is required');
    return new TurboHire({ apiKey });
  }

  async listJobs(options?: { status?: string; page?: number }): Promise<THJob[]> {
    return this.client.request<THJob[]>('/jobs', { params: { status: options?.status, page: options?.page } });
  }
  async getJob(jobId: string): Promise<THJob> { return this.client.request<THJob>(`/jobs/${jobId}`); }
  async createJob(data: { title: string; department?: string; location?: string; type?: string; description?: string; requirements?: string }): Promise<THJob> {
    return this.client.request<THJob>('/jobs', { method: 'POST', body: data as Record<string, unknown> });
  }

  async listCandidates(jobId: string, options?: { page?: number; per_page?: number; stage_id?: string }): Promise<THCandidateList> {
    return this.client.request<THCandidateList>(`/jobs/${jobId}/candidates`, { params: { page: options?.page, per_page: options?.per_page, stage_id: options?.stage_id } });
  }
  async getCandidate(jobId: string, candidateId: string): Promise<THCandidate> {
    return this.client.request<THCandidate>(`/jobs/${jobId}/candidates/${candidateId}`);
  }
  async moveCandidate(jobId: string, candidateId: string, stageId: string): Promise<void> {
    await this.client.request(`/jobs/${jobId}/candidates/${candidateId}/move`, { method: 'POST', body: { stage_id: stageId } });
  }

  async listStages(jobId: string): Promise<THStage[]> { return this.client.request<THStage[]>(`/jobs/${jobId}/stages`); }

  async listInterviews(jobId: string, candidateId: string): Promise<THInterview[]> {
    return this.client.request<THInterview[]>(`/jobs/${jobId}/candidates/${candidateId}/interviews`);
  }
  async scheduleInterview(jobId: string, candidateId: string, data: { type: string; scheduled_at: string; duration: number; interviewer_ids: string[] }): Promise<THInterview> {
    return this.client.request<THInterview>(`/jobs/${jobId}/candidates/${candidateId}/interviews`, { method: 'POST', body: data as Record<string, unknown> });
  }

  getClient(): TurboHireClient { return this.client; }
}
