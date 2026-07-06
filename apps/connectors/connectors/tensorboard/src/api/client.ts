import type { TensorBoardEnvironment } from '../types';
import { TensorBoardApiError } from '../types';

export const DEFAULT_BASE_URL = 'http://localhost:6006';

export interface TensorBoardClientOptions {
  /** Base URL of the running TensorBoard server. Defaults to http://localhost:6006. */
  baseUrl?: string;
}

/** Raw shape of `/data/plugin/scalars/tags`: run -> tag -> tag metadata. */
export type RawScalarTags = Record<string, Record<string, { displayName?: string; description?: string }> | string[]>;

/** Raw scalar series: `[wall_time, step, value]` tuples. */
export type RawScalarSeries = Array<[number, number, number]>;

/**
 * Low-level HTTP transport for the public, unauthenticated TensorBoard data API.
 * No credentials are ever sent — TensorBoard's data endpoints are read-only and open.
 */
export class TensorBoardClient {
  readonly baseUrl: string;

  constructor(options: TensorBoardClientOptions = {}) {
    const raw = (options.baseUrl || DEFAULT_BASE_URL).trim();
    // Preserve any sub-path but drop trailing slashes for consistent joining.
    this.baseUrl = raw.replace(/\/+$/, '');
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(path, `${this.baseUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private async get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    const url = this.buildUrl(path, query);

    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (err) {
      throw new TensorBoardApiError(`Could not reach TensorBoard at ${this.baseUrl} (${String(err)})`);
    }

    if (!response.ok) {
      throw new TensorBoardApiError(
        `TensorBoard API error ${response.status}: ${response.statusText}`,
        response.status,
      );
    }

    try {
      return (await response.json()) as T;
    } catch (err) {
      throw new TensorBoardApiError(`Failed to parse TensorBoard response from ${url} (${String(err)})`);
    }
  }

  /** GET /data/runs — list of run names. */
  listRuns(): Promise<string[]> {
    return this.get<string[]>('data/runs');
  }

  /** GET /data/plugin/scalars/tags — scalar tags grouped by run. */
  scalarTags(): Promise<RawScalarTags> {
    return this.get<RawScalarTags>('data/plugin/scalars/tags');
  }

  /** GET /data/plugin/scalars/scalars — raw scalar series for a run/tag pair. */
  scalars(run: string, tag: string): Promise<RawScalarSeries> {
    return this.get<RawScalarSeries>('data/plugin/scalars/scalars', { run, tag });
  }

  /** GET /data/environment — server/experiment metadata. */
  environment(): Promise<TensorBoardEnvironment> {
    return this.get<TensorBoardEnvironment>('data/environment');
  }
}
