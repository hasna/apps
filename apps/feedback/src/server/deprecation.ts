// One source of truth for the `feedback-serve` deprecation, imported by both the
// bin (src/server/cli.ts) and the `feedback serve` subcommand (src/cli/index.ts)
// so the two cannot drift into telling users different stories.
//
// WHY THE BIN IS GOING AWAY, measured rather than asserted:
// `src/server/cli.ts` constructs the server with only { host, port }.
// `startFeedbackServer` then falls back to `createFeedbackStore()` with no
// options, and `createFeedbackStore` throws in cloud mode without a
// host-injected adapter (`src/storage.ts`). So `FEEDBACK_STORE=postgres
// feedback-serve` cannot start, ever. A `<name>-serve` bin is the fleet's
// conventional declaration of a run-me-as-a-service product story; this one can
// only ever be a single-box local JSONL convenience. Withdrawing it retracts a
// false advertisement — it does not remove a capability, because the identical
// server remains available as `feedback serve`, as the exported
// `startFeedbackServer()`, and as `createFeedbackHandler()`.
//
// WHY THE SUBCOMMAND IS DEMOTED IN THE SAME CHANGE:
// `feedback serve` runs the IDENTICAL code path and is therefore exactly as
// incapable of PostgreSQL as the bin. Dropping the bin while leaving the
// subcommand advertising an unqualified "HTTP API" would move the conformance
// report without changing what ships. The description below is the honest label.

/** The bin being withdrawn. */
export const DEPRECATED_BIN = "feedback-serve";

/** What callers should use instead — the same server, one hyphen fewer. */
export const REPLACEMENT_COMMAND = "feedback serve";

/**
 * The release that removes the bin. The stub ships in 0.3.0; removal is the next
 * boundary after that. Keep this in step with package.json — the test in
 * deprecation.test.ts fails if this is not strictly ahead of the shipped version.
 */
export const REMOVAL_VERSION = "0.4.0";

/** Description for the `feedback serve` subcommand, scoped to what it can truthfully do. */
export const SERVE_DESCRIPTION =
  "Start the Hasna Feedback HTTP API for local development (local JSONL store only; no PostgreSQL support)";

/**
 * The warning text emitted by the deprecated bin.
 *
 * Written to stderr, never stdout: scripted callers parse stdout for the
 * "listening on" line and for `--version`, and a deprecation stub that breaks
 * those callers has done the one thing it exists to avoid.
 */
export function deprecationNotice(): string {
  return [
    `warning: \`${DEPRECATED_BIN}\` is deprecated and will be removed in v${REMOVAL_VERSION}.`,
    `  Use \`${REPLACEMENT_COMMAND}\` instead — the same server, the same --host/--port options.`,
    `  Neither form supports PostgreSQL; the HTTP server runs the local JSONL store only.`,
  ].join("\n");
}

/** Emit the notice. Injectable so tests can capture it without a real stderr. */
export function emitDeprecationNotice(write: (message: string) => void = (m) => console.error(m)): void {
  write(deprecationNotice());
}
