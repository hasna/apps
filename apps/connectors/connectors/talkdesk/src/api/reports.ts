import type { TalkdeskClient } from './client';
import type { TalkdeskReportJob, TalkdeskReportJobParams } from '../types';

/**
 * Talkdesk Explore Reporting API (asynchronous historical reports).
 * A report is requested by creating a job; once the job reports a `done`
 * status it can be downloaded via the link returned in the job payload.
 * https://docs.talkdesk.com/docs/explore-api
 */
export class ReportsApi {
  constructor(private readonly client: TalkdeskClient) {}

  /** Create a calls report job. */
  async createCallsJob(params?: TalkdeskReportJobParams): Promise<TalkdeskReportJob> {
    return this.client.post<TalkdeskReportJob>('/data/reports/calls/jobs', params ?? {});
  }

  /** Get the status of a previously created calls report job. */
  async getCallsJob(jobId: string): Promise<TalkdeskReportJob> {
    return this.client.get<TalkdeskReportJob>(`/data/reports/calls/jobs/${encodeURIComponent(jobId)}`);
  }
}
