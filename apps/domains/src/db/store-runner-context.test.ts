/**
 * Regression: the production-write guard must hold OUTSIDE a test run.
 *
 * THE DEFECT. `store-test-isolation.test.ts` pinned that a test run never
 * reaches the production store. It does that by keying on `NODE_ENV=test`, so
 * it protects `bun test` and nothing else. Measured on bun 1.3.14, station01,
 * 2026-08-07:
 *
 *   bun test <file>   NODE_ENV="test"    -> guard fires
 *   bun run <script>  NODE_ENV unset     -> guard does NOT fire
 *   bun <file>        NODE_ENV unset     -> guard does NOT fire
 *
 * A plain `bun run` script that set `DOMAINS_DB_PATH` therefore wrote 230 rows
 * into the production portfolio while printing success and creating no sqlite
 * file. `scripts/capture-tui-screenshot.ts` in this repo has exactly that shape
 * (it sets `DOMAINS_DIR` and calls `createDomain`), so the hazard was live here
 * and not merely hypothetical.
 *
 * WHY THIS FILE SPAWNS SUBPROCESSES. Anything `bun test` executes is inside the
 * protected context by construction, so no in-process assertion can exercise
 * the unprotected one — which is precisely why the gap survived a green suite.
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

/** Fixture cloud credentials. Unresolvable host, non-credential key. */
const CLOUD_FIXTURE = {
  HASNA_DOMAINS_API_URL: "https://domains.example.invalid",
  HASNA_DOMAINS_API_KEY: "not-a-real-key-fixture-only",
};

type ProbeResult = {
  outcome: string;
  nodeEnv: string;
  vitest: string;
  jestWorkerId: string;
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
      ...CLOUD_FIXTURE,
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

describe("production-write guard outside a test run", () => {
  test("CONTROL: the spawned context really is unprotected, and can report cloud", () => {
    const probe = runUnprotected({});

    // If this ever fails, the child became a "test run" and every assertion
    // below would pass for the wrong reason.
    expect(probe.nodeEnv).toBe("<unset>");
    expect(probe.vitest).toBe("<unset>");
    expect(probe.jestWorkerId).toBe("<unset>");

    // And the probe is capable of reporting cloud-http, so a `local` result
    // below is a real outcome rather than an instrument that cannot say cloud.
    expect(probe.outcome).toBe("cloud-http");
  });

  test("BUG PINNED: DOMAINS_DB_PATH + cloud env outside a test run must NOT resolve cloud", () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-guard-"));
    try {
      const probe = runUnprotected({ DOMAINS_DB_PATH: join(dir, "scratch.db") });
      expect(probe.nodeEnv).toBe("<unset>");
      expect(probe.outcome).not.toBe("cloud-http");
      expect(probe.outcome).toStartWith("THREW:");
      expect(probe.outcome).toContain("DOMAINS_DB_PATH");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("BUG PINNED: DOMAINS_DIR + cloud env outside a test run must NOT resolve cloud", () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-guard-"));
    try {
      const probe = runUnprotected({ DOMAINS_DIR: dir });
      expect(probe.outcome).not.toBe("cloud-http");
      expect(probe.outcome).toStartWith("THREW:");
      expect(probe.outcome).toContain("DOMAINS_DIR");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the refusal names a route that actually works: STORAGE_MODE=local takes the path", () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-guard-"));
    try {
      const probe = runUnprotected({
        DOMAINS_DB_PATH: join(dir, "scratch.db"),
        HASNA_DOMAINS_STORAGE_MODE: "local",
      });
      expect(probe.outcome).toBe("local");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ESCAPE HATCH: an explicit opt-out keeps cloud despite the local path", () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-guard-"));
    try {
      const probe = runUnprotected({
        DOMAINS_DB_PATH: join(dir, "scratch.db"),
        HASNA_DOMAINS_ALLOW_CLOUD_WITH_LOCAL_PATH: "1",
      });
      expect(probe.outcome).toBe("cloud-http");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the escape hatch does NOT fail open on an explicit refusal", () => {
    const dir = mkdtempSync(join(tmpdir(), "domains-guard-"));
    try {
      for (const refusal of ["0", "false", "no", "off"]) {
        const probe = runUnprotected({
          DOMAINS_DB_PATH: join(dir, "scratch.db"),
          HASNA_DOMAINS_ALLOW_CLOUD_WITH_LOCAL_PATH: refusal,
        });
        expect(probe.outcome).toStartWith("THREW:");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("NO REGRESSION: cloud env with no local path still resolves cloud outside a test run", () => {
    expect(runUnprotected({ NODE_ENV: "production" }).outcome).toBe("cloud-http");
  });
});
