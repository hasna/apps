import type { ConnectorClient } from './client';
import { encodePathSegment } from './client';
import type { CaseListParams, JsonRecord } from '../types';

export class CasesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: CaseListParams): Promise<JsonRecord> {
    return this.client.get<JsonRecord>('/cases', params as Record<string, string | number | boolean | undefined>);
  }

  async get(caseId: string): Promise<JsonRecord> {
    return this.client.get<JsonRecord>(`/cases/${encodePathSegment(caseId)}`);
  }

  async create(body: JsonRecord): Promise<JsonRecord> {
    return this.client.post<JsonRecord>('/cases', body);
  }
}
