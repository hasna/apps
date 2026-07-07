import type { StitchClient } from './client';

/**
 * Stitch Replication (sync) API.
 * Starts or stops the replication job for a source.
 * @see https://www.stitchdata.com/docs/developers/stitch-connect/api#start-a-replication-job
 */
export class ReplicationApi {
  constructor(private readonly client: StitchClient) {}

  /** Start a replication job for a source. */
  start(sourceId: number): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>(`/v4/sources/${sourceId}/sync`);
  }

  /** Stop the currently running replication job for a source. */
  stop(sourceId: number): Promise<Record<string, unknown>> {
    return this.client.delete<Record<string, unknown>>(`/v4/sources/${sourceId}/sync`);
  }
}
