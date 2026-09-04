/**
 * Port resolution shared by every entry point that can start the HTTP
 * server: the standalone `todos-serve` entry (src/server/index.ts) and the
 * `todos serve` CLI command (src/cli/commands/config-serve-commands.ts).
 *
 * These had independent copies of the same two primitives, and only one of them
 * was ever hardened — so `todos-serve --port=abc` fell back to the default while
 * `todos serve --port abc` passed NaN through to Bun.serve and silently bound a
 * random ephemeral port. One parser, one scan, one default.
 */

/** Documented default port for the HTTP/API server. */
export const DEFAULT_PORT = 19427;

/**
 * Parses a port, returning undefined for anything that is not a valid one.
 *
 * `0` is MEANINGFUL: it asks the kernel for a free ephemeral port. Coercing with
 * `parseInt(...) || DEFAULT_PORT` silently rewrote `--port=0` to the default,
 * which made "let the OS pick a port" impossible to request — the reason
 * subprocess tests used to guess ports out of hardcoded ranges and race each
 * other for them. Only reject values that are not a port at all.
 */
export function coercePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  // Must be digits and nothing else. `Number.parseInt` stops at the first
  // non-digit, which is worse than useless here: parseInt("0x10", 10) is 0, and 0
  // is the one value with special meaning (ephemeral), so garbage would have been
  // promoted into a silent random-port bind — the same failure this function
  // exists to prevent. "1e3" -> 1 and "12abc" -> 12 were equally wrong.
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  // Ephemeral must be spelled exactly "0". `/^\d+$/` also admits "00" and "000",
  // which parse to 0 and would therefore request a random port — and `--port 00`
  // is far likelier to be a typo for a real port than a deliberate ask for an
  // arbitrary one. Requesting the kernel's choice should be unambiguous.
  if (trimmed.length > 1 && trimmed.startsWith("0")) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed > 65535) return undefined;
  return parsed;
}

/**
 * Refuses an explicitly supplied port that is not a port at all.
 *
 * Silently substituting the default is the same defect class as the silent
 * ephemeral bind this module was written to remove: the operator asked for one
 * thing, got another, and was told nothing. A typo in a port is always a mistake
 * worth stopping for, and stopping costs nothing — the server had not started.
 * Absent input is NOT an error; only a value that was provided and cannot be a
 * port.
 */
export function refuseInvalidPort(source: string, raw: string): never {
  console.error(
    `Invalid ${source}: ${JSON.stringify(raw)} is not a port.\n`
    + `Use an integer from 0 to 65535, where 0 asks the kernel for a free port.`,
  );
  process.exit(1);
}

/**
 * Finds the first free port at or after `start`, scanning a bounded window.
 *
 * The two callers apply DIFFERENT policies to this, deliberately:
 *
 *  - `todos-serve` (src/server/index.ts) scans only for the IMPLICIT default. A
 *    port requested explicitly, or via PORT, is bound exactly or the process
 *    fails, because a container health check would otherwise target the wrong
 *    port.
 *  - `todos serve` (the CLI) scans for any non-zero port, including an explicit
 *    one. That is long-standing dev-convenience behavior — `--port 8080` with
 *    8080 busy starts on 8081 — and changing it is a user-facing decision, not
 *    something to slip into a test-fragility change.
 *
 * Only `--port 0` bypasses the scan in both, since the kernel is already being
 * asked to choose.
 */
export async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    try {
      const server = Bun.serve({ port, fetch: () => new Response("") });
      server.stop(true);
      return port;
    } catch {
      // Port in use, try next
    }
  }
  return start; // fallback
}
