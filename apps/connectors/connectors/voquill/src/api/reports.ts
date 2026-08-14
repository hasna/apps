import type { ConnectorClient } from './client';
import { encodePathSegment } from './client';
import type { JsonRecord } from '../types';

export class ReportsApi {
  constructor(private readonly client: ConnectorClient) {}

  async createDraft(caseId: string, body: JsonRecord): Promise<JsonRecord> {
    return this.client.post<JsonRecord>(`/cases/${encodePathSegment(caseId)}/reports`, body);
  }

  async get(reportId: string): Promise<JsonRecord> {
    return this.client.get<JsonRecord>(`/reports/${encodePathSegment(reportId)}`);
  }

  async suggestCptCodes(caseId: string, body: JsonRecord): Promise<JsonRecord> {
    return this.client.post<JsonRecord>(`/cases/${encodePathSegment(caseId)}/cpt-suggestions`, body);
  }
}
