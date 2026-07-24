import type { StitchClient } from './client';
import type { StitchSourceType, StitchDestinationType } from '../types';

/**
 * Stitch Source Types (integration catalog) API.
 * @see https://www.stitchdata.com/docs/developers/stitch-connect/api#source-types
 */
export class SourceTypesApi {
  constructor(private readonly client: StitchClient) {}

  /** List all available source types. */
  list(): Promise<StitchSourceType[]> {
    return this.client.get<StitchSourceType[]>('/v4/source-types');
  }

  /** Retrieve a single source type by its type name (e.g. "platform.hubspot"). */
  get(type: string): Promise<StitchSourceType> {
    return this.client.get<StitchSourceType>(`/v4/source-types/${encodeURIComponent(type)}`);
  }
}

/**
 * Stitch Destination Types (warehouse catalog) API.
 * @see https://www.stitchdata.com/docs/developers/stitch-connect/api#destination-types
 */
export class DestinationTypesApi {
  constructor(private readonly client: StitchClient) {}

  /** List all available destination types. */
  list(): Promise<StitchDestinationType[]> {
    return this.client.get<StitchDestinationType[]>('/v4/destination-types');
  }

  /** Retrieve a single destination type by its type name. */
  get(type: string): Promise<StitchDestinationType> {
    return this.client.get<StitchDestinationType>(`/v4/destination-types/${encodeURIComponent(type)}`);
  }
}
