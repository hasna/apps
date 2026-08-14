// Failure accounting shared by every polling watcher in this package.
//
// A watcher that cannot reach its store must not be indistinguishable from a
// watcher with nothing to report. Each poll loop reports failures through this
// helper so that all of them degrade the same way and an operator learns the
// same thing from any of them.
//
// EVERYTHING HERE WRITES TO STDERR, never stdout. `conversations-mcp` speaks
// JSON-RPC over stdout; a stray line there corrupts the protocol stream for
// every MCP client on the box. If you change the sink, keep it off stdout.

/** How a failure line reaches the operator. Defaults to stderr. */
export type PollHealthReporter = (line: string) => void;

export interface PollHealthOptions {
  /** Short name of the loop, e.g. "watch" or "channel-notifications". */
  label: string;
  /** Consecutive failures before the loop is called DEGRADED. */
  degradedAfter?: number;
  /** Minimum gap between repeated DEGRADED lines, so a long outage does not flood. */
  repeatEveryMs?: number;
  /** Injectable sink; tests and non-console hosts override it. */
  report?: PollHealthReporter;
  /** Injectable clock, so the throttle is testable without waiting. */
  now?: () => number;
}

export interface PollHealth {
  /** Record a failed poll and report it. Never throws. */
  recordFailure(error: unknown): void;
  /** Record a successful poll; announces RECOVERED if the loop was degraded. */
  recordSuccess(): void;
  /** Consecutive failures right now; 0 when healthy. */
  readonly consecutiveFailures: number;
  /** Whether the loop is currently past the degraded threshold. */
  readonly degraded: boolean;
}

/**
 * Render an error for an operator WITHOUT leaking a credential.
 *
 * Deliberately narrow: an Error contributes only its `message`, and an HTTP
 * failure only `method`, `path` and `status`. A response `body` or `headers`
 * can carry an Authorization header or a token echoed back by a server, so
 * they are never read, and arbitrary objects are never deep-stringified.
 */
export function describeError(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { status?: unknown; path?: unknown; method?: unknown };
    if (typeof candidate.status === "number" && typeof candidate.path === "string") {
      const method = typeof candidate.method === "string" ? candidate.method : "REQUEST";
      return `${method} ${candidate.path} -> ${candidate.status}`;
    }
  }
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (cause: ${cause.message})` : "";
    return `${error.message}${causeText}`;
  }
  return typeof error === "string" ? error : String(error);
}

/**
 * Track consecutive poll failures and make them visible.
 *
 * Reporting shape:
 * - every failure up to the threshold is reported individually, so a single
 *   transient blip is still seen;
 * - the threshold failure is labelled DEGRADED;
 * - while degraded, DEGRADED repeats at most once per `repeatEveryMs`, because
 *   a monitor that goes quiet during an outage is the bug being fixed, and one
 *   that prints every 200ms is a monitor nobody reads;
 * - the first success after a degraded run reports RECOVERED.
 */
export function createPollHealth(options: PollHealthOptions): PollHealth {
  const label = options.label;
  const degradedAfter = Math.max(1, options.degradedAfter ?? 3);
  const repeatEveryMs = Math.max(0, options.repeatEveryMs ?? 30_000);
  const report: PollHealthReporter = options.report ?? ((line) => console.error(line));
  const now = options.now ?? (() => Date.now());

  let consecutive = 0;
  let lastDegradedReportAt = 0;

  const emit = (line: string) => {
    // A reporting failure must never take down the poll loop it is describing.
    try { report(line); } catch { /* nothing useful to do here */ }
  };

  return {
    get consecutiveFailures() { return consecutive; },
    get degraded() { return consecutive >= degradedAfter; },

    recordFailure(error: unknown) {
      consecutive += 1;
      const detail = describeError(error);

      if (consecutive < degradedAfter) {
        emit(`[${label}] poll failed (${consecutive}): ${detail}`);
        return;
      }

      const at = now();
      const isTransition = consecutive === degradedAfter;
      if (isTransition || at - lastDegradedReportAt >= repeatEveryMs) {
        lastDegradedReportAt = at;
        emit(
          `[${label}] DEGRADED — ${consecutive} consecutive poll failures, ` +
          `not reading messages. Last error: ${detail}`,
        );
      }
    },

    recordSuccess() {
      if (consecutive >= degradedAfter) {
        emit(`[${label}] RECOVERED — polling again after ${consecutive} consecutive failures.`);
      }
      consecutive = 0;
      lastDegradedReportAt = 0;
    },
  };
}
