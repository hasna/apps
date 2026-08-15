import type { StitchClient } from './client';
import type { StitchExtraction, StitchLoad, StitchPage } from '../types';

export interface ReportingListOptions {
  /** 1-based page number (reporting endpoints return 100 records/page). */
  page?: number;
}

/**
 * Stitch reporting API for extraction (tap) jobs and destination loads.
 * These endpoints are scoped to a Stitch client (account) id.
 * @see https://www.stitchdata.com/docs/developers/stitch-connect/api#extractions
 */
export class ReportingApi {
  constructor(private readonly client: StitchClient) {}

  private resolveClientId(clientId?: number): number {
    const id = clientId ?? this.client.getClientId();
    if (id === undefined) {
      throw new Error(
        'A Stitch client id is required for reporting endpoints. Set STITCH_CLIENT_ID or pass --client-id.',
      );
    }
    return id;
  }

  /** List extraction jobs for the account (paginated). */
  listExtractions(
    options: ReportingListOptions = {},
    clientId?: number,
  ): Promise<StitchPage<StitchExtraction>> {
    const id = this.resolveClientId(clientId);
    return this.client.get<StitchPage<StitchExtraction>>(`/v4/${id}/extractions`, {
      page: options.page,
    });
  }

  /** Retrieve the log output for a single extraction job. */
  getExtractionLog(jobName: string, clientId?: number): Promise<string> {
    const id = this.resolveClientId(clientId);
    return this.client.get<string>(`/v4/${id}/extractions/${encodeURIComponent(jobName)}`);
  }

  /** List load events for the account (paginated). */
  listLoads(
    options: ReportingListOptions = {},
    clientId?: number,
  ): Promise<StitchPage<StitchLoad>> {
    const id = this.resolveClientId(clientId);
    return this.client.get<StitchPage<StitchLoad>>(`/v4/${id}/loads`, {
      page: options.page,
    });
  }
}
