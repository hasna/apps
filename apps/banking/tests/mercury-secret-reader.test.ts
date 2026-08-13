/**
 * REGRESSION (todos I22-00057): `@hasna/secrets` 0.2.9 hardened `secrets get` to
 * REFUSE to print a value when stdout is not a TTY. `readSecretWithCli` spawns the
 * CLI with `stdout: "pipe"` — a pipe is by definition not a TTY — so from 0.2.9
 * onward the real reader took the refusal on EVERY call, saw a non-zero exit, and
 * returned `undefined`. The live Mercury credential became unreachable via
 * `--secret-key`, and the operator-visible signal was the generic "Missing Mercury
 * API key" message, which points at an absent credential rather than at a refused
 * read.
 *
 * WHY THIS SURVIVED: every pre-existing test in tests/mercury-live.test.ts injects
 * a fake through `input.readSecret`, so the real CLI-spawning path had ZERO
 * coverage. These tests drive the REAL `readSecretWithCli` against a fake `secrets`
 * placed on PATH that is faithful to installed 0.2.10:
 *   - `get <key>`                 -> exit 1, EMPTY stdout, refusal reason on stderr
 *   - `get <key> --show`          -> prints the value (the explicit escape hatch)
 *   - `exec <key> --as V -- cmd`  -> runs cmd with V in its environment
 *
 * A regression back to bare `secrets get` FAILS these tests.
 *
 * No real credential is used anywhere here: the fixture value is a literal invented
 * in this file, and the fake CLI is a shell script written to a temp dir.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readSecretWithCli } from "../src/providers/mercury-live.ts";

/** Invented in this file. Not a credential, and deliberately multi-token. */
const FIXTURE_VALUE = "mercury-fixture-value-LINE1";
const FIXTURE_KEY = "fixture/mercury/api_key";

let binDir: string;
let originalPath: string | undefined;

/**
 * A stand-in for @hasna/secrets 0.2.10. The behaviour that matters is that `get`
 * WITHOUT --show refuses on a non-TTY: exit 1, nothing on stdout, reason on stderr.
 */
function writeFakeSecretsCli(dir: string): void {
  const script = `#!/usr/bin/env bash
set -uo pipefail
sub="\${1:-}"; shift || true

if [ "$sub" = "get" ]; then
  key="\${1:-}"; shift || true
  show=0
  for a in "$@"; do [ "$a" = "--show" ] && show=1; done
  if [ "$key" != "${FIXTURE_KEY}" ]; then
    echo "Not found: $key" >&2
    exit 1
  fi
  if [ "$show" = "1" ]; then
    printf '%s\\n' "${FIXTURE_VALUE}"
    exit 0
  fi
  # The 0.2.9+ hardening: stdout is a pipe here, so refuse and say why.
  echo "Refusing to print the value of \\"$key\\" to captured output. Use \\\`secrets exec <key> [--as VAR] -- <cmd>\\\`, \\\`--check\\\`, or \\\`--show\\\`." >&2
  exit 1
fi

if [ "$sub" = "exec" ]; then
  key="\${1:-}"; shift || true
  var="SECRET_VALUE"
  if [ "\${1:-}" = "--as" ]; then var="\${2:-}"; shift 2; fi
  if [ "\${1:-}" = "--" ]; then shift; fi
  if [ "$key" != "${FIXTURE_KEY}" ]; then
    echo "Not found: $key" >&2
    exit 1
  fi
  export "$var=${FIXTURE_VALUE}"
  exec "$@"
fi

echo "unknown subcommand: $sub" >&2
exit 2
`;
  const p = join(dir, "secrets");
  writeFileSync(p, script, { mode: 0o755 });
  chmodSync(p, 0o755);
}

beforeAll(() => {
  binDir = mkdtempSync(join(tmpdir(), "i22-00057-fake-secrets-"));
  writeFakeSecretsCli(binDir);
  originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;
});

afterAll(() => {
  if (originalPath !== undefined) process.env.PATH = originalPath;
  rmSync(binDir, { recursive: true, force: true });
});

describe("readSecretWithCli against a non-TTY-hardened secrets CLI", () => {
  // POSITIVE CONTROL for the fixture itself: proves the fake CLI can serve the
  // value at all, so a failure below is the reader's, not the fixture's.
  test("control: the fake CLI does serve the value through `exec`", () => {
    const probe = Bun.spawnSync(
      ["secrets", "exec", FIXTURE_KEY, "--as", "V", "--", "printenv", "V"],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, PATH: `${binDir}:${originalPath ?? ""}` } },
    );
    expect(probe.exitCode).toBe(0);
    expect(new TextDecoder().decode(probe.stdout).trim()).toBe(FIXTURE_VALUE);
  });

  // NEGATIVE CONTROL: proves the fake reproduces the refusal that broke the reader.
  test("control: bare `get` on a pipe refuses with exit 1 and empty stdout", () => {
    const probe = Bun.spawnSync(["secrets", "get", FIXTURE_KEY], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: `${binDir}:${originalPath ?? ""}` },
    });
    expect(probe.exitCode).toBe(1);
    expect(new TextDecoder().decode(probe.stdout)).toBe("");
    expect(new TextDecoder().decode(probe.stderr)).toContain("Refusing to print the value");
  });

  // THE REGRESSION. Fails on the bare-`get` implementation.
  test("reads the value back despite the non-TTY refusal", () => {
    expect(readSecretWithCli(FIXTURE_KEY)).toBe(FIXTURE_VALUE);
  });

  // The other direction: a genuinely absent key must still yield undefined, so the
  // fix cannot pass by returning something for everything.
  test("returns undefined for a key the vault does not have", () => {
    expect(readSecretWithCli("fixture/definitely/absent")).toBeUndefined();
  });
});
