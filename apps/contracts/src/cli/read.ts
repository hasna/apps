/**
 * `contracts read` — run a Hasna collection read and either prove it whole or refuse.
 *
 * Exit codes follow the convention probe-guard already established on this fleet, so
 * an agent does not have to hold two vocabularies:
 *   0  the read is proven complete; rows are on stdout
 *   2  REFUSED — completeness could not be established (the interesting one)
 *   3  usage error
 *
 * A refusal is never an empty result. Nothing is printed to stdout that a caller
 * could mistake for a population.
 */

import { safeRead, type SafeReadResult } from "../safe-read-exec";

export interface ReadCliOptions {
  rowsKey?: string | undefined;
  totalKey?: string | undefined;
  limitFlag?: string | undefined;
  limit?: string | undefined;
  widenTo?: string | undefined;
  knownClamp?: string | undefined;
  cursorFlag?: string | undefined;
  maxPages?: string | undefined;
  siblingArg?: string[] | undefined;
  siblingPath?: string | undefined;
  probeNegativeArg?: string[] | undefined;
  probePositiveArg?: string[] | undefined;
  allowEmpty?: boolean | undefined;
  assumeComplete?: boolean | undefined;
  scopeAck?: string | undefined;
  json?: boolean | undefined;
}

function toInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} must be a positive integer, got '${value}'`);
  }
  return n;
}

export function runSafeReadCli(
  argv: string[],
  options: ReadCliOptions,
  io: { log: (s: string) => void; err: (s: string) => void } = {
    log: (s) => console.log(s),
    err: (s) => console.error(s)
  }
): number {
  if (argv.length === 0) {
    io.err("contracts read: no command given. Usage: contracts read [options] -- <command> [args...]");
    return 3;
  }

  let result: SafeReadResult;
  try {
    result = safeRead({
      argv,
      rowsKey: options.rowsKey,
      totalKey: options.totalKey,
      allowEmpty: options.allowEmpty,
      limitFlag: options.limitFlag,
      limit: toInt(options.limit, "--limit"),
      widenTo: toInt(options.widenTo, "--widen-to"),
      knownClamp: toInt(options.knownClamp, "--known-clamp"),
      cursorFlag: options.cursorFlag,
      maxPages: toInt(options.maxPages, "--max-pages"),
      siblingArgv: options.siblingArg,
      siblingPath: options.siblingPath,
      probeNegativeArgs: options.probeNegativeArg,
      probePositiveArgs: options.probePositiveArg,
      assumeComplete: options.assumeComplete,
      scopeAck: options.scopeAck
    });
  } catch (error) {
    io.err(`contracts read: ${error instanceof Error ? error.message : String(error)}`);
    return 3;
  }

  if (options.json) {
    // On refusal `rows` is absent, not empty: a consumer that reaches for it must
    // get undefined and fail, never a plausible zero.
    io.log(
      JSON.stringify(
        result.ok
          ? { ok: true, proofs: result.proofs, rowCount: result.rowCount, pages: result.pages, scope: result.scope, rows: result.rows, evidence: result.evidence }
          : { ok: false, code: result.code, error: result.reason, pages: result.pages, scope: result.scope, evidence: result.evidence },
        null,
        2
      )
    );
    return result.ok ? 0 : 2;
  }

  if (result.ok) {
    io.err(`contracts read: PASS — ${result.reason}`);
    for (const line of result.evidence) io.err(`  ${line}`);
    io.log(JSON.stringify(result.rows, null, 2));
    return 0;
  }

  io.err(`contracts read: REFUSED [${result.code}]`);
  io.err(`  ${result.reason}`);
  for (const line of result.evidence) io.err(`  ${line}`);
  io.err("  No rows are printed. A refused read is not an empty set.");
  return 2;
}
