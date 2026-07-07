import type { ConnectorClient } from './client';
import type {
  CreateJobParams,
  Job,
  ListJobsParams,
  WorkableListResponse,
} from '../types';

export class JobsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListJobsParams): Promise<WorkableListResponse<Job>> {
    return this.client.get<WorkableListResponse<Job>>('/jobs', {
      state: params?.state,
      limit: params?.limit,
      since_id: params?.sinceId,
      created_after: params?.createdAfter,
    });
  }

  async get(shortcode: string): Promise<Job> {
    return this.client.get<Job>(`/jobs/${encodeURIComponent(shortcode)}`);
  }

  async create(params: CreateJobParams): Promise<Job> {
    return this.client.post<Job>('/jobs', {
      job: {
        title: params.title,
        full_title: params.full_title,
        locations: params.locations,
        description: params.description,
        requirements: params.requirements,
        benefits: params.benefits,
        department_id: params.departmentId,
        function_id: params.functionId,
        industry_id: params.industryId,
        experience: params.experience,
        education: params.education,
        salary: params.salary,
        remote: params.remote,
        employment_type: params.employment_type,
      },
    });
  }
}
