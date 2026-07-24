import type { StitchConfig } from '../types';
import { StitchClient } from './client';
import { SourcesApi } from './sources';
import { DestinationsApi } from './destinations';
import { SourceTypesApi, DestinationTypesApi } from './source-types';
import { StreamsApi } from './streams';
import { ReplicationApi } from './replication';
import { ReportingApi } from './loads-extractions';

/**
 * Main Stitch (Stitch Connect) connector.
 * Provides access to sources, destinations, source/destination types,
 * streams, replication jobs, and extraction/load reporting.
 */
export class Stitch {
  private readonly client: StitchClient;

  public readonly sources: SourcesApi;
  public readonly destinations: DestinationsApi;
  public readonly sourceTypes: SourceTypesApi;
  public readonly destinationTypes: DestinationTypesApi;
  public readonly streams: StreamsApi;
  public readonly replication: ReplicationApi;
  public readonly reporting: ReportingApi;

  constructor(config: StitchConfig) {
    this.client = new StitchClient(config);
    this.sources = new SourcesApi(this.client);
    this.destinations = new DestinationsApi(this.client);
    this.sourceTypes = new SourceTypesApi(this.client);
    this.destinationTypes = new DestinationTypesApi(this.client);
    this.streams = new StreamsApi(this.client);
    this.replication = new ReplicationApi(this.client);
    this.reporting = new ReportingApi(this.client);
  }

  /**
   * Create a Stitch connector from environment variables.
   * Looks for STITCH_ACCESS_TOKEN, and optionally STITCH_CLIENT_ID / STITCH_BASE_URL.
   */
  static fromEnv(): Stitch {
    const accessToken = process.env.STITCH_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('STITCH_ACCESS_TOKEN environment variable is required');
    }
    const clientIdRaw = process.env.STITCH_CLIENT_ID;
    const clientId = clientIdRaw ? Number(clientIdRaw) : undefined;

    return new Stitch({
      accessToken,
      clientId: clientId !== undefined && !Number.isNaN(clientId) ? clientId : undefined,
      baseUrl: process.env.STITCH_BASE_URL,
    });
  }

  /** A masked preview of the access token, for display/debugging. */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /** The configured Stitch client (account) id, if any. */
  getClientId(): number | undefined {
    return this.client.getClientId();
  }

  /** The underlying HTTP client, for direct/advanced API access. */
  getClient(): StitchClient {
    return this.client;
  }
}

export { StitchClient } from './client';
export { SourcesApi } from './sources';
export { DestinationsApi } from './destinations';
export { SourceTypesApi, DestinationTypesApi } from './source-types';
export { StreamsApi } from './streams';
export { ReplicationApi } from './replication';
export { ReportingApi } from './loads-extractions';
export type { ReportingListOptions } from './loads-extractions';
