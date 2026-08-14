import type { StitchClient } from './client';
import type { StitchStream, StreamMetadataUpdate } from '../types';

/**
 * Stitch Streams API.
 * Streams are the tables/objects a source can replicate.
 * @see https://www.stitchdata.com/docs/developers/stitch-connect/api#streams
 */
export class StreamsApi {
  constructor(private readonly client: StitchClient) {}

  /** List all streams for a source. */
  list(sourceId: number): Promise<StitchStream[]> {
    return this.client.get<StitchStream[]>(`/v4/sources/${sourceId}/streams`);
  }

  /** Retrieve a single stream (including its schema) by id. */
  get(sourceId: number, streamId: number): Promise<StitchStream> {
    return this.client.get<StitchStream>(`/v4/sources/${sourceId}/streams/${streamId}`);
  }

  /**
   * Update stream selection/replication metadata for a source.
   * Accepts one or more metadata patches keyed by tap stream id.
   * @see https://www.stitchdata.com/docs/developers/stitch-connect/api#update-a-streams-metadata
   */
  updateMetadata(
    sourceId: number,
    updates: StreamMetadataUpdate[],
  ): Promise<StitchStream[]> {
    return this.client.put<StitchStream[]>(`/v4/sources/${sourceId}/streams/metadata`, {
      streams: updates,
    });
  }
}
