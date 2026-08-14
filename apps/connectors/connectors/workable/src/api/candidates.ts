import type { ConnectorClient } from './client';
import type {
  Candidate,
  CopyCandidateParams,
  CreateCandidateParams,
  DisqualifyCandidateParams,
  ListJobCandidatesParams,
  MoveCandidateParams,
  UpdateCandidateParams,
  WorkableListResponse,
} from '../types';

export class CandidatesApi {
  constructor(private readonly client: ConnectorClient) {}

  async listForJob(params: ListJobCandidatesParams): Promise<WorkableListResponse<Candidate>> {
    const { shortcode, ...query } = params;
    return this.client.get<WorkableListResponse<Candidate>>(
      `/jobs/${encodeURIComponent(shortcode)}/candidates`,
      {
        stage: query.stage,
        state: query.state,
        limit: query.limit,
        since_id: query.sinceId,
      },
    );
  }

  async create(params: CreateCandidateParams): Promise<Candidate> {
    return this.client.post<Candidate>(
      `/jobs/${encodeURIComponent(params.shortcode)}/candidates`,
      {
        candidate: params.candidate,
        domain: params.domain,
      },
    );
  }

  async get(id: string): Promise<Candidate> {
    return this.client.get<Candidate>(`/candidates/${encodeURIComponent(id)}`);
  }

  async update(params: UpdateCandidateParams): Promise<Candidate> {
    return this.client.patch<Candidate>(`/candidates/${encodeURIComponent(params.id)}`, {
      candidate: params.candidate,
    });
  }

  async moveStage(params: MoveCandidateParams): Promise<Candidate> {
    return this.client.post<Candidate>(`/candidates/${encodeURIComponent(params.id)}/move`, {
      target_stage: params.targetStage,
    });
  }

  async copy(params: CopyCandidateParams): Promise<Candidate> {
    return this.client.post<Candidate>(`/candidates/${encodeURIComponent(params.id)}/copy`, {
      target_job_shortcode: params.targetJobShortcode,
    });
  }

  async disqualify(params: DisqualifyCandidateParams): Promise<Candidate> {
    return this.client.post<Candidate>(`/candidates/${encodeURIComponent(params.id)}/disqualify`, {
      disqualification_reason: params.disqualificationReason,
      member_id: params.disqualifiedBy,
    });
  }

  async revert(id: string): Promise<Candidate> {
    return this.client.post<Candidate>(`/candidates/${encodeURIComponent(id)}/revert`);
  }
}
