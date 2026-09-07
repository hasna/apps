import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPackageVersion } from "../lib/version.js";

/**
 * domains-serve --help/-h must answer BEFORE the signing secret is resolved.
 * Previously only --version/-V short-circuited; --help fell through to
 * `resolveSigningSecret()` and died with "Missing API-key signing secret"
 * (rc=1, no usage) — hasna/apps#1720 validation, P2. No port is ever bound
 * on these paths, so the probes run with an empty environment and never need
 * a free port.
 *
 * Each child gets a minimal, constructed env: no signing secret, no DSN, a
 * scratch HOME, and HASNA_STATION pinned to a sentinel so the ambient
 * Keychain tier cannot supply anything on a provisioned station.
 */
const PACKAGE_ROOT = join(import.meta.dir, "..", "..");
const SERVE_ENTRY = "src/server/index.ts";

function runServe(args: string[], home: string): { exitCode: number | null; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "run", SERVE_ENTRY, ...args],
    cwd: PACKAGE_ROOT,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      HASNA_STATION: "no-such-station",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("domains-serve informational flags answer before any environment is resolved", () => {
  for (const flag of ["--help", "-h"]) {
    test(`${flag} prints usage and exits 0 without a signing secret`, () => {
      const home = mkdtempSync(join(tmpdir(), "domains-serve-help-"));
      try {
        const result = runServe([flag], home);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("Usage: domains-serve");
        expect(result.stdout).toContain("--port");
        expect(result.stdout).toContain("HASNA_DOMAINS_API_SIGNING_KEY");
        expect(result.stderr).not.toContain("Missing API-key signing secret");
        expect(result.stdout).not.toContain("domains_serve_started");
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  }

  for (const flag of ["--version", "-V"]) {
    test(`${flag} prints the package version and exits 0 without a signing secret`, () => {
      const home = mkdtempSync(join(tmpdir(), "domains-serve-version-"));
      try {
        const result = runServe([flag], home);
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe(getPackageVersion());
        expect(result.stderr).not.toContain("Missing API-key signing secret");
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  }

  test("NEGATIVE: a plain start with no signing secret still fails loudly before binding", () => {
    const home = mkdtempSync(join(tmpdir(), "domains-serve-neg-"));
    try {
      const result = runServe([], home);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Missing API-key signing secret");
      expect(result.stdout).not.toContain("domains_serve_started");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
