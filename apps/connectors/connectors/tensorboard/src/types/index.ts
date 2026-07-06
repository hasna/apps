export type OutputFormat = 'json' | 'pretty' | 'table';

/** A single training run tracked by a TensorBoard server. */
export interface RunInfo {
  name: string;
}

/** A scalar tag available under a given run (e.g. "loss", "accuracy"). */
export interface ScalarTag {
  run: string;
  tag: string;
  displayName?: string;
  description?: string;
}

/** One point in a scalar time series. */
export interface ScalarPoint {
  /** Wall-clock time in unix seconds. */
  wallTime: number;
  /** Training step index. */
  step: number;
  /** Recorded scalar value. */
  value: number;
}

/** Metadata reported by the TensorBoard `/data/environment` endpoint. */
export interface TensorBoardEnvironment {
  version?: string;
  dataLocation?: string;
  windowTitle?: string;
  experimentName?: string;
  experimentDescription?: string;
  creationTime?: number;
}

export class TensorBoardApiError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'TensorBoardApiError';
  }
}
