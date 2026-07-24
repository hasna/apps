import chalk from "chalk";

/**
 * Emit a CLI error while respecting the `--json` output contract, then exit(1).
 *
 * With `--json` (or `--contract`), a parseable JSON error object is written to
 * stdout so consumers that JSON-parse command output do not crash on failure.
 * Otherwise a human-readable red message is written to stderr, matching the
 * previous plain-text behaviour.
 *
 * The JSON shape (`{ "error": <message>, ...extra }`) matches the error objects
 * already emitted elsewhere in the CLI (e.g. project create/delete, update).
 */
export function emitCliError(
  message: string,
  opts: { json?: boolean; contract?: boolean } = {},
  extra: Record<string, unknown> = {},
): never {
  if (opts.json || opts.contract) {
    console.log(JSON.stringify({ error: message, ...extra }));
  } else {
    console.error(chalk.red(message));
  }
  process.exit(1);
}
