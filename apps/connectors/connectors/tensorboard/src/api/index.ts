import { TensorBoardClient, type TensorBoardClientOptions } from './client';
import { listRuns } from './runs';
import { listScalarTags, getScalars } from './scalars';
import type { RunInfo, ScalarTag, ScalarPoint, TensorBoardEnvironment } from '../types';

/**
 * High-level facade over the TensorBoard data API. Read-only and unauthenticated.
 */
export class TensorBoard {
  readonly client: TensorBoardClient;

  constructor(options?: TensorBoardClientOptions) {
    this.client = new TensorBoardClient(options);
  }

  get baseUrl(): string {
    return this.client.baseUrl;
  }

  /** List all runs tracked by the server. */
  listRuns(): Promise<RunInfo[]> {
    return listRuns(this.client);
  }

  /** List scalar tags, optionally filtered to a single run. */
  listScalarTags(run?: string): Promise<ScalarTag[]> {
    return listScalarTags(this.client, run);
  }

  /** Fetch a scalar time series for a run/tag pair. */
  getScalars(run: string, tag: string): Promise<ScalarPoint[]> {
    return getScalars(this.client, run, tag);
  }

  /** Fetch server/experiment metadata. */
  environment(): Promise<TensorBoardEnvironment> {
    return this.client.environment();
  }
}

export { TensorBoardClient, DEFAULT_BASE_URL } from './client';
export { listRuns } from './runs';
export { listScalarTags, getScalars } from './scalars';
export { TensorBoard as Connector };
