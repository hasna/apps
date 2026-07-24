import type { SmartRecruitersClient } from './client';
import type {
  Job,
  JobStatus,
  HiringTeamMember,
  SmartRecruitersListResponse,
} from '../types';

export interface ListJobsParams {
  /** Free-text query matched against job title */
  q?: string;
  limit?: number;
  offset?: number;
  /** Job status filter, e.g. SOURCING, FILLED, CANCELLED, ON_HOLD */
  status?: string;
  /** Posting status filter, e.g. PUBLIC, INTERNAL, PRIVATE, DRAFT */
  postingStatus?: string;
}

/**
 * SmartRecruiters Jobs API (`/jobs`).
 * Manage the requisitions/jobs configured in a company.
 */
export class JobsApi {
  constructor(private readonly client: SmartRecruitersClient) {}

  /** List jobs for the authenticated company. */
  async list(params?: ListJobsParams): Promise<SmartRecruitersListResponse<Job>> {
    const queryParams: Record<string, string | number | boolean | undefined> = {};
    if (params?.q) queryParams.q = params.q;
    if (params?.limit !== undefined) queryParams.limit = params.limit;
    if (params?.offset !== undefined) queryParams.offset = params.offset;
    if (params?.status) queryParams.status = params.status;
    if (params?.postingStatus) queryParams.postingStatus = params.postingStatus;

    return this.client.get<SmartRecruitersListResponse<Job>>('/jobs', queryParams);
  }

  /** Get a single job by id. */
  async get(jobId: string): Promise<Job> {
    return this.client.get<Job>(`/jobs/${encodeURIComponent(jobId)}`);
  }

  /** Get the status of a job. */
  async getStatus(jobId: string): Promise<JobStatus> {
    return this.client.get<JobStatus>(`/jobs/${encodeURIComponent(jobId)}/status`);
  }

  /** List the hiring team members assigned to a job. */
  async getHiringTeam(jobId: string): Promise<SmartRecruitersListResponse<HiringTeamMember>> {
    return this.client.get<SmartRecruitersListResponse<HiringTeamMember>>(
      `/jobs/${encodeURIComponent(jobId)}/hiring-team`
    );
  }
}
