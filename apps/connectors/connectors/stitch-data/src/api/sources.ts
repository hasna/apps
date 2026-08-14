import type { StitchClient } from './client';
import type {
  StitchSource,
  CreateSourceRequest,
  UpdateSourceRequest,
  StitchConnectionCheck,
} from '../types';

/**
 * Stitch Sources API.
 * @see https://www.stitchdata.com/docs/developers/stitch-connect/api#sources
 */
export class SourcesApi {
  constructor(private readonly client: StitchClient) {}

  /** List all sources for the account. */
  list(): Promise<StitchSource[]> {
    return this.client.get<StitchSource[]>('/v4/sources');
  }

  /** Retrieve a single source by id. */
  get(sourceId: number): Promise<StitchSource> {
    return this.client.get<StitchSource>(`/v4/sources/${sourceId}`);
  }

  /** Create a new source. */
  create(data: CreateSourceRequest): Promise<StitchSource> {
    return this.client.post<StitchSource>('/v4/sources', data);
  }

  /** Update an existing source. */
  update(sourceId: number, data: UpdateSourceRequest): Promise<StitchSource> {
    return this.client.put<StitchSource>(`/v4/sources/${sourceId}`, data);
  }

  /** Delete a source. */
  delete(sourceId: number): Promise<Record<string, unknown>> {
    return this.client.delete<Record<string, unknown>>(`/v4/sources/${sourceId}`);
  }

  /**
   * Pause a source by setting `paused_at` to the provided timestamp
   * (defaults to the caller-supplied ISO timestamp).
   */
  pause(sourceId: number, pausedAt: string): Promise<StitchSource> {
    return this.client.put<StitchSource>(`/v4/sources/${sourceId}`, { paused_at: pausedAt });
  }

  /** Unpause a source by clearing `paused_at`. */
  unpause(sourceId: number): Promise<StitchSource> {
    return this.client.put<StitchSource>(`/v4/sources/${sourceId}`, { paused_at: null });
  }

  /** Retrieve the most recent connection check result for a source. */
  lastConnectionCheck(sourceId: number): Promise<StitchConnectionCheck> {
    return this.client.get<StitchConnectionCheck>(`/v4/sources/${sourceId}/last-connection-check`);
  }
}
