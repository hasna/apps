/**
 * The suite's deliberate timeout policy, and the measurements behind it.
 *
 * WHY THIS EXISTS
 *
 * Until this landed, the suite ran on Bun's *framework default* per-test
 * timeout of 5000ms. Nobody in this repo chose that number: there was no
 * bunfig.toml, no `--timeout` in any package script, and no per-test timeout
 * argument anywhere in the suite. It asserted no performance property and
 * guarded no regression — it was the default kill-switch inherited from a
 * framework whose default is tuned for in-process unit tests.
 *
 * 11 of this repo's test files instead drive real subprocesses. Their
 * wall-clock duration is `N spawns x per-spawn process-boot cost`, and that
 * cost is set by CPU contention on the host, not by the code under test.
 * Measured on station01 (20 cores) at loadavg 8-12:
 *
 *   ordinary `bun src/cli/index.ts --json list`   0.31 - 1.18s   (4x spread)
 *   `machines list`                               1.54 - 2.03s
 *   `machines show local`                         2.26 - 3.01s
 *
 * So a 9-spawn functional test ranges from ~2.8s to ~10.6s purely as a
 * function of how busy the machine is. A full-suite run duly failed 5-6 tests
 * at 5001-5626ms and blocked the 0.4.31 publish, because `prepublishOnly`
 * runs the whole suite. A wall-clock kill on subprocess-bound tests measures
 * the machine, not the code. That is the defect this policy fixes.
 *
 * WHY A BIGGER NUMBER IS NOT, BY ITSELF, THE FIX
 *
 * Raising a load-sensitive budget just moves the cliff: at loadavg 90
 * (measured on this fleet during an unpaced sweep) the same test is slower
 * again. The load-sensitive control has to be *replaced*, not enlarged. So the
 * thing the default was incidentally providing — "notice a CLI that hangs
 * forever" — is now enforced where it is deterministic and load-insensitive:
 * at the spawn boundary, via CLI_SPAWN_TIMEOUT_MS. A hung child is killed with
 * ETIMEDOUT naming the command that hung, which is also a far better
 * diagnostic than "this test timed out after 5000ms".
 *
 * With hang detection moved there, SUITE_TIMEOUT_MS is a pure backstop and
 * only has to sit far enough above legitimate worst-case that host load
 * cannot reach it.
 *
 * WHY THE FLAG AND NOT bunfig.toml — MEASURED, NOT ASSUMED
 *
 * Two plausible-looking mechanisms silently do not work on bun 1.3.14, and
 * both are recorded here so nobody "simplifies" the scripts back into them:
 *
 *   1. `[test] timeout = N` in bunfig.toml is parsed and IGNORED. A test still
 *      died at the 5000ms default with `timeout = 20000` set.
 *   2. `setDefaultTimeout()` — whether called from a `[test] preload` hook or
 *      imported directly by a test file — applies only when a SINGLE test file
 *      is run. In a multi-file run it has no effect: the same probe passed
 *      alone and died at 5003ms as soon as a second file joined the run.
 *
 * Mechanism 2 is the dangerous one, because it works exactly when you test it
 * the obvious way (one file) and silently fails in the real full-suite gate.
 * Only the `--timeout` CLI flag was measured to hold across a multi-file run,
 * so the policy lives on the `test` and `prepublishOnly` scripts in
 * package.json, and test-timeout-policy.test.ts asserts it is still there.
 */

/** Bun's framework default, recorded so the policy test can prove we left it. */
export const BUN_DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Per-test backstop, passed as `--timeout` by the `test` and `prepublishOnly`
 * scripts. Hangs are caught at the spawn boundary; this only bounds a
 * pathological case that is not a hung subprocess.
 *
 * Justified against measured worst case rather than a round number: worst
 * observed legitimate test was 5.2s at loadavg ~10. 120_000ms is ~23x that,
 * and ~5x a pessimistic estimate of the same test at loadavg 90 (~21s,
 * extrapolating the 4x spread already measured between a quiet and a loaded
 * spawn).
 */
export const SUITE_TIMEOUT_MS = 120_000;

/**
 * Hard ceiling on a single CLI subprocess spawned by a test.
 *
 * The deterministic, load-insensitive control that replaces the per-test
 * wall-clock kill. Worst legitimate single invocation measured was
 * `machines show local` at 3.01s, so 60s is ~20x headroom: a loops CLI
 * invocation that has not returned in a minute is hung, not slow.
 *
 * It lives in this module rather than in a *.test.ts file so tests can import
 * it without re-registering that file's test cases.
 */
export const CLI_SPAWN_TIMEOUT_MS = 60_000;

/**
 * WHY THE WORKFLOW SCAN BELOW PARSES INSTEAD OF GREPPING
 *
 * The policy test that guards `.github/workflows` used to read each file as
 * raw lines and treat any line matching `bun test` as an invocation. A comment
 * is not an invocation, and that parser was measurably wrong in BOTH
 * directions in this repository at the same time:
 *
 *   - FALSE POSITIVE. release.yml carries the comment "`bun test` does not
 *     invoke tsc in this repository", which has no `--timeout` because it is
 *     prose. The scan reported it as a bare invocation and failed CI on both
 *     runners, while the workflow's real command two lines below was the
 *     compliant `bun test --timeout 120000`.
 *   - FALSE NEGATIVE. ci.yml carries the comment "`bun run test`, not bare
 *     `bun test`". The scan matched it as an invocation, then took the
 *     `bun run test` early-exit and waved it through — so a comment was
 *     silently counted as a compliant invocation, and it padded the very
 *     positive control that is supposed to prove the scan found real commands.
 *
 * Both faults are the same root: prose was being read as code. So the scan
 * parses the workflow and inspects only the executable content of `run:`
 * steps, and strips shell comments inside those steps as well, because a `#`
 * line inside a `run: |` block is prose too.
 *
 * Comment stripping is quote-aware rather than a cut at the first `#`. That
 * matters in the under-blocking direction, which is the dangerous one: a naive
 * cut on `echo "a # b" && bun test` would discard the real bare invocation
 * along with the quoted `#` and report the workflow clean.
 */

/** One `bun test` invocation found in a workflow's executable content. */
export interface WorkflowBunTestInvocation {
  /** The workflow file it was found in, e.g. `release.yml`. */
  workflow: string;
  /** The single command it appeared in, with comments already removed. */
  command: string;
  /** The explicit `--timeout` budget in ms, or null when none is present. */
  timeoutMs: number | null;
  /**
   * True only for `bun run test`, which resolves to the `test` script and so
   * inherits the budget asserted separately against package.json. Set false
   * whenever a bare `bun test` is also present in the same command, so a
   * command carrying both is judged on the bare one rather than excused by the
   * other — that excuse is exactly the false negative described above.
   */
  viaTestScript: boolean;
}

/**
 * Remove shell comments from a script, honouring single and double quotes so a
 * `#` inside a string cannot truncate the command that follows it.
 *
 * Quote state is tracked across the whole script rather than per line, because
 * a shell string may legitimately span lines. Newlines are preserved so that
 * command boundaries survive the strip.
 */
export function stripShellComments(script: string): string {
  let out = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < script.length; i += 1) {
    const ch = script[i]!;

    // A backslash escapes the next character everywhere except inside single
    // quotes, where it is literal.
    if (ch === "\\" && !inSingle && i + 1 < script.length) {
      out += ch + script[i + 1];
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      continue;
    }

    // `#` opens a comment only when it starts a word and is unquoted.
    if (ch === "#" && !inSingle && !inDouble && /\s/.test(i === 0 ? "\n" : script[i - 1]!)) {
      while (i < script.length && script[i] !== "\n") i += 1;
      if (i < script.length) out += "\n";
      continue;
    }

    out += ch;
  }

  return out;
}

/** Every `run:` script in a parsed workflow, in document order. */
function runScripts(workflowSource: string): string[] {
  const scripts: string[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "run" && typeof value === "string") scripts.push(value);
      walk(value);
    }
  };

  walk(Bun.YAML.parse(workflowSource));
  return scripts;
}

/**
 * Every `bun test` invocation in a workflow's executable content.
 *
 * Commands are separated on `&&`, `||`, `;`, `|` and newlines so that a
 * `--timeout` belonging to a later command cannot be read as covering an
 * earlier bare one.
 */
export function findBunTestInvocations(
  workflow: string,
  workflowSource: string,
): WorkflowBunTestInvocation[] {
  const invocations: WorkflowBunTestInvocation[] = [];

  for (const script of runScripts(workflowSource)) {
    for (const command of stripShellComments(script).split(/&&|\|\||;|\||\n/)) {
      if (!/\bbun\s+(?:run\s+)?test\b/.test(command)) continue;

      const bare = /\bbun\s+test\b/.test(command);
      const match = /\bbun\s+test\b.*?--timeout\s+(\d+)/.exec(command);
      invocations.push({
        workflow,
        command: command.trim(),
        timeoutMs: match ? Number(match[1]) : null,
        viaTestScript: !bare && /\bbun\s+run\s+test\b/.test(command),
      });
    }
  }

  return invocations;
}
