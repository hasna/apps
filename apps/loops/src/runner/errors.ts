/**
 * Runner error taxonomy. Extracted from index.ts so the failure-episode
 * recorder can classify by `instanceof` against this module's own types
 * without an import cycle. The opacity contract is unchanged: only errors
 * this package constructs itself are ever surfaced by message; foreign
 * errors stay opaque everywhere, including in episode events and state.
 */

/** A refusal this package raises itself: static, safe-by-construction message
 *  (no provider detail, no credentials). logRunnerCommandFailure surfaces the
 *  reason for these and keeps every other error opaque. Every construction
 *  site must pass a string this module wrote itself. */
export class RunnerRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerRefusalError";
  }
}

/** Module-private: a /version probe failure THIS code classified itself.
 *  Only ever constructed with static text plus `response.status` (a number),
 *  so its message is safe to interpolate into a surfaced refusal. Foreign
 *  fetch/parse errors must NOT be converted to this type. */
export class VersionProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionProbeError";
  }
}

/**
 * A control-plane response with a non-2xx status. The message carries what it
 * always carried (the server's `error` field when present, else a static
 * prefix with the numeric status) — but failure classification MUST read only
 * `status` (a number this code observed), never the message, because the
 * server-provided `error` string is foreign text.
 */
export class LoopsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LoopsApiError";
    this.status = status;
  }
}
