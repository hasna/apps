// Breezy HR Connector — Recruiting and applicant tracking system
import { BreezyHRClient } from './client';
import type { BreezyHRConfig, BreezyCompany, BreezyPosition, BreezyCandidate, BreezyStage, BreezyUser } from '../types';
export { BreezyHRClient } from './client';

export class BreezyHR {
  private readonly client: BreezyHRClient;
  constructor(config: BreezyHRConfig) { this.client = new BreezyHRClient(config); }
  static fromEnv(): BreezyHR {
    const token = process.env.BREEZYHR_TOKEN;
    if (!token) throw new Error('BREEZYHR_TOKEN is required');
    return new BreezyHR({ token });
  }

  async listCompanies(): Promise<BreezyCompany[]> { return this.client.request<BreezyCompany[]>('/companies'); }
  async getCompany(companyId: string): Promise<BreezyCompany> { return this.client.request<BreezyCompany>(`/company/${companyId}`); }

  async listPositions(companyId: string, options?: { state?: string }): Promise<BreezyPosition[]> {
    return this.client.request<BreezyPosition[]>(`/company/${companyId}/positions`, { params: { state: options?.state } });
  }
  async getPosition(companyId: string, positionId: string): Promise<BreezyPosition> {
    return this.client.request<BreezyPosition>(`/company/${companyId}/position/${positionId}`);
  }
  async createPosition(companyId: string, data: { name: string; department?: string; type?: { id: string }; location?: { city?: string; state?: string; country?: string } }): Promise<BreezyPosition> {
    return this.client.request<BreezyPosition>(`/company/${companyId}/positions`, { method: 'POST', body: data as Record<string, unknown> });
  }

  async listCandidates(companyId: string, positionId: string): Promise<BreezyCandidate[]> {
    return this.client.request<BreezyCandidate[]>(`/company/${companyId}/position/${positionId}/candidates`);
  }
  async getCandidate(companyId: string, positionId: string, candidateId: string): Promise<BreezyCandidate> {
    return this.client.request<BreezyCandidate>(`/company/${companyId}/position/${positionId}/candidate/${candidateId}`);
  }
  async createCandidate(companyId: string, positionId: string, data: { name: string; email_address?: string; phone_number?: string; origin?: string }): Promise<BreezyCandidate> {
    return this.client.request<BreezyCandidate>(`/company/${companyId}/position/${positionId}/candidates`, { method: 'POST', body: data as Record<string, unknown> });
  }
  async moveCandidate(companyId: string, positionId: string, candidateId: string, stageId: string): Promise<void> {
    await this.client.request(`/company/${companyId}/position/${positionId}/candidate/${candidateId}/move`, { method: 'PUT', body: { stage_id: stageId } });
  }

  async listStages(companyId: string, positionId: string): Promise<BreezyStage[]> {
    return this.client.request<BreezyStage[]>(`/company/${companyId}/position/${positionId}/stages`);
  }

  async listTeamMembers(companyId: string): Promise<BreezyUser[]> {
    return this.client.request<BreezyUser[]>(`/company/${companyId}/members`);
  }

  getClient(): BreezyHRClient { return this.client; }
}
