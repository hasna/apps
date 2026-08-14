import type { CreateReportParams, ListReportsParams, Report } from '../types';
import { ConnectorClient, encodePathSegment } from './client';

export class ReportsApi {
  constructor(private readonly client: ConnectorClient) {}

  list(params?: ListReportsParams): Promise<unknown> {
    return this.client.get<unknown>('/reports', params);
  }

  create(body: CreateReportParams): Promise<Report> {
    return this.client.post<Report>('/reports', body);
  }

  get(reportId: string): Promise<Report> {
    return this.client.get<Report>(`/reports/${encodePathSegment(reportId)}`);
  }
}
