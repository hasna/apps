import type { VelaClient } from './client';
import type {
  CreateSchedulingRequestParams,
  ListParams,
  SchedulingRequest,
} from '../types';

export class SchedulingRequestsApi {
  constructor(private readonly client: VelaClient) {}

  async list(params?: ListParams): Promise<SchedulingRequest[]> {
    return this.client.get<SchedulingRequest[]>('/scheduling-requests', params);
  }

  async get(requestId: string): Promise<SchedulingRequest> {
    return this.client.get<SchedulingRequest>(
      `/scheduling-requests/${encodeURIComponent(requestId)}`,
    );
  }

  async create(params: CreateSchedulingRequestParams): Promise<SchedulingRequest> {
    return this.client.post<SchedulingRequest>('/scheduling-requests', params);
  }
}
