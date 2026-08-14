import type { ConnectorClient } from './client';
import type { BoundedRequest, Filters, UnboundedRequest } from '../types';

export class EventlogApi {
  constructor(private readonly client: ConnectorClient) {}

  query(filters?: Filters): Promise<BoundedRequest[]> {
    const params: Record<string, string | undefined> = {};
    if (filters) {
      params.filters = JSON.stringify(filters);
    }
    return this.client.get<BoundedRequest[]>('/v1/eventlog/query', params);
  }

  get(requestID: string): Promise<UnboundedRequest> {
    return this.client.get<UnboundedRequest>(`/v1/eventlog/${encodeURIComponent(requestID)}`);
  }

  generatePostman(requestID: string): Promise<string> {
    return this.client.request<string>(
      `/v1/eventlog/${encodeURIComponent(requestID)}/generate/postman`,
      { raw: true }
    );
  }
}
