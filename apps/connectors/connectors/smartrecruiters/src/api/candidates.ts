import type { SmartRecruitersClient } from './client';
import type {
  Candidate,
  CandidateStatus,
  SmartRecruitersListResponse,
} from '../types';

export interface ListCandidatesParams {
  /** Free-text query matched against candidate name/email */
  q?: string;
  limit?: number;
  offset?: number;
  /** Filter to candidates updated on or after this ISO-8601 timestamp */
  updatedAfter?: string;
}

/**
 * SmartRecruiters Candidates API (`/candidates`).
 * Read candidates and the candidates (applications) assigned to a job.
 */
export class CandidatesApi {
  constructor(private readonly client: SmartRecruitersClient) {}

  /** List candidates in the company talent pool. */
  async list(params?: ListCandidatesParams): Promise<SmartRecruitersListResponse<Candidate>> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.q) queryParams.q = params.q;
    if (params?.limit !== undefined) queryParams.limit = params.limit;
    if (params?.offset !== undefined) queryParams.offset = params.offset;
    if (params?.updatedAfter) queryParams.updatedAfter = params.updatedAfter;

    return this.client.get<SmartRecruitersListResponse<Candidate>>('/candidates', queryParams);
  }

  /** Get a single candidate by id. */
  async get(candidateId: string): Promise<Candidate> {
    return this.client.get<Candidate>(`/candidates/${encodeURIComponent(candidateId)}`);
  }

  /** List candidates (applications) assigned to a specific job. */
  async listByJob(
    jobId: string,
    params?: { limit?: number; offset?: number; status?: string }
  ): Promise<SmartRecruitersListResponse<Candidate>> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit !== undefined) queryParams.limit = params.limit;
    if (params?.offset !== undefined) queryParams.offset = params.offset;
    if (params?.status) queryParams.status = params.status;

    return this.client.get<SmartRecruitersListResponse<Candidate>>(
      `/jobs/${encodeURIComponent(jobId)}/candidates`,
      queryParams
    );
  }

  /** Get the status of a candidate on a specific job. */
  async getStatus(jobId: string, candidateId: string): Promise<CandidateStatus> {
    return this.client.get<CandidateStatus>(
      `/jobs/${encodeURIComponent(jobId)}/candidates/${encodeURIComponent(candidateId)}/status`
    );
  }
}
