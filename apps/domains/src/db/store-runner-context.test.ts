/**
 * The store-resolution contract must hold OUTSIDE a test run.
 *
 * THE DEFECT THIS PINS. The suite isolates with `DOMAINS_DIR` (a mkdtemp
 * directory). That variable is read only by `getDbPath()` in `database.ts`,
 * which is reached only from `LocalStore` — i.e. only AFTER the transport has
 * been chosen. The transport is chosen by the shared resolver from
 * `HASNA_DOMAINS_API_URL` + `HASNA_DOMAINS_API_KEY`, so on a box where the API
 * vars were exported every `createDomain()` in the suite went to the production
 * API while the author believed it was writing to a temp directory. Measured
 * evidence: 122 rows in the hour 2026-07-11T18, twelve more across
 * 2026-07-24/30/31, and 230 rows in a single `bun run` script on 2026-08-07.
 *
 * The adoption ruling (hasna/apps#1720, class B) answers with the SHARED
 * resolver's fail-closed contract instead of a per-runner guard: a local path
 * opt-in is honoured only when the environment configures no authority and no
 * credential (so the suite's scrubbed env can never reach production), and a
 * local path set NEXT TO a configured credential is a LOUD conflict in every
 * runner — `bun test` or a plain `bun file.js`.
 *
 * WHY THIS FILE SPAWNS SUBPROCESSES. `bun run` scripts are outside the suite
 * context by construction, and a script that sets `DOMAINS_DIR` and calls
 * `createDomain` is exactly the shape that reached production in the past.
 * The only way to test the real unprotected runner is to spawn it.
 *
 * Every child gets an explicit minimal environment rather than inheriting this
 * one: the API URL is `.invalid` (RFC 2606, unresolvable) and the key is a
 * fixture literal, so no real credential can reach a child and no child can
 * reach a real host. Assertions are on the OUTCOME the child reports, never on
 * whether a variable was set.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROBE = new URL("../test/fixtures/resolve-store-probe.ts", import.meta.url).pathname;

/** Fixture hosted-client env. Unresolvable host, non-credential key. */
const HOSTED_FIXTURE = {
  HASNA_DOMAINS_API_URL: "https://domains.example.invalid",
  HASNA_DOMAINS_API_KEY: "not-a-real-key-fixture-only",
};

type ProbeResult = {
  outcome: string;
};

/**
 * Run the probe as a plain `bun <file>` subprocess — the unprotected context.
 * The child environment is built from scratch; `process.env` is deliberately
 * NOT spread in, so this box's real domains credentials cannot leak into it.
 */
function runUnprotected(extra: Record<string, string>): ProbeResult {
  const result = Bun.spawnSync({
    cmd: ["bun", PROBE],
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      ...HOSTED_FIXTURE,
      ...extra,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = result.stdout.toString().trim();
  const line = stdout.split("\n").filter(Boolean).at(-1) ?? "";
  if (!line.startsWith("{")) {
    throw new Error(
      `probe produced no JSON (exit ${result.exitCode}). stdout=${stdout} stderr=${result.stderr.toString().slice(0, 400)}`,
    );
  }
  return JSON.parse(line) as ProbeResult;
}

describe("store resolution outside a test run (plain bun subprocess)", () => {
  test("CONTROL: cloud env with no local path resolves http outside a test run", () => {
    expect(runUnprotected({}).outcome).toBe("http");
  });

  test("BUG PINNED: DOMAINS_DB_PATH + cloud env must NOT resolve cloud or local — it is a loud conflict", () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-guard-"));
    try {
      const probe = runUnprotected({ DOMAINS_DB_PATH: join(dir, "scratch.db") });
      expect(probe.outcome).toStartWith("THREW:");
      expect(probe.outcome).toContain("DOMAINS_DB_PATH");
      expect(probe.outcome).toContain("Refusing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("BUG PINNED: DOMAINS_DIR + cloud env must NOT resolve cloud or local either", () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-guard-"));
    try {
      const probe = runUnprotected({ DOMAINS_DIR: dir });
      expect(probe.outcome).toStartWith("THREW:");
      expect(probe.outcome).toContain("DOMAINS_DIR");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a local path with NOTHING else configured is the explicit opt-in: local", () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-guard-"));
    try {
      const probe = runUnprotected({
        DOMAINS_DB_PATH: join(dir, "scratch.db"),
        HASNA_DOMAINS_API_URL: "",
        HASNA_DOMAINS_API_KEY: "",
      });
      expect(probe.outcome).toBe("local");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no credential and no local opt-in fails closed in the unprotected runner too", () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-guard-"));
    try {
      const probe = runUnprotected({
        HASNA_DOMAINS_API_URL: "https://domains.example.invalid",
        HASNA_DOMAINS_API_KEY: "",
        HOME: dir,
      });
      expect(probe.outcome).toStartWith("THREW:");
      expect(probe.outcome).toContain("fails closed");
      expect(probe.outcome).toContain("HASNA_DOMAINS_API_KEY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});