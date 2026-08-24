import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { getPackageVersion } from "../src/version.js";

/**
 * Regression tests for the control-surfaces class (todos row cbb7ca3d).
 *
 * `snapshots --version` previously fell through to the default `help`
 * command and printed usage JSON instead of the version; `snapshots-mcp
 * --version` entered stdio mode, printed nothing, and exited rc=0 silently
 * when stdin closed; `snapshots-serve --version` ignored argv and bound the
 * HTTP port. Same defect class as styles-mcp (row 0d02f8b9, PR 844) and
 * tickets serve/mcp (row 5fcf7a67, PR 848).
 *
 * The probes assert the exact contract: --version prints the package
 * version and --help prints usage, both rc=0, with no dispatch, no MCP
 * protocol traffic, and no server bind.
 */

const SNAPSHOTS_ROOT = join(import.meta.dir, "..");

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

async function runEntry(entry: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, "run", entry, ...args], {
    cwd: SNAPSHOTS_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });
  proc.stdin?.end(); // close stdin so a stdio server cannot wait on it
  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("snapshots CLI answers --version/--help before dispatch", () => {
  test("--version prints the package version, not usage JSON", async () => {
    const result = await runEntry("src/cli/index.ts", ["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout).not.toContain("usage");
  });

  test("-V prints the package version", async () => {
    const result = await runEntry("src/cli/index.ts", ["-V"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
  });

  test("--help prints usage and exits 0", async () => {
    const result = await runEntry("src/cli/index.ts", ["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("usage");
  });
});

describe("snapshots-mcp answers --version/--help without entering stdio", () => {
  test("--version prints the package version and exits", async () => {
    const result = await runEntry("src/mcp/index.ts", ["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout).not.toContain("jsonrpc");
  });

  test("--help prints usage and exits", async () => {
    const result = await runEntry("src/mcp/index.ts", ["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("snapshots-mcp");
    expect(result.stdout).not.toContain("jsonrpc");
  });
});

describe("snapshots-serve answers --version/--help without binding", () => {
  test("--version prints the package version and exits", async () => {
    const result = await runEntry("src/server/index.ts", ["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(getPackageVersion());
    expect(result.stdout).not.toContain("listening");
  });

  test("--help prints usage and exits", async () => {
    const result = await runEntry("src/server/index.ts", ["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("snapshots-serve");
    expect(result.stdout).not.toContain("listening");
  });
});

describe("snapshots CLI max-age gate", () => {
  test("restore --max-age refuses an old snapshot with a logged error", async () => {
    const { SnapshotStore } = await import("../src/storage.js");
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dbPath = join(mkdtempSync(join(tmpdir(), "snapshots-cli-maxage-")), "snapshots.sqlite");
    const store = new SnapshotStore({ path: dbPath });
    try {
      store.saveSnapshot(
        [{
          id: "project:aged",
          kind: "project",
          name: "aged",
          source: "projects",
          attributes: { path: join(tmpdir(), "aged-project") },
          observedAt: "2026-06-19T00:00:00.000Z"
        }],
        { id: "snap_old", createdAt: "2026-06-19T00:00:00.000Z" }
      );
    } finally {
      store.close();
    }

    const result = await runEntry("src/cli/index.ts", ["restore", "snap_old", "--db", dbPath, "--max-age", "1h"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('"ok": false');
    expect(result.stdout).toContain("max-age");
    expect(result.stdout).toContain("Refusing restore");
    expect(result.stderr).toContain("[snapshots]");
  });

  test("restore --max-age allows a fresh snapshot", async () => {
    const { SnapshotStore } = await import("../src/storage.js");
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const dbPath = join(mkdtempSync(join(tmpdir(), "snapshots-cli-fresh-")), "snapshots.sqlite");
    const store = new SnapshotStore({ path: dbPath });
    try {
      store.saveSnapshot(
        [{
          id: "project:fresh",
          kind: "project",
          name: "fresh",
          source: "projects",
          attributes: { path: join(tmpdir(), "fresh-project") },
          observedAt: "2026-08-24T00:00:00.000Z"
        }],
        { id: "snap_fresh", createdAt: "2026-08-24T00:00:00.000Z" }
      );
    } finally {
      store.close();
    }

    const result = await runEntry("src/cli/index.ts", ["restore", "snap_fresh", "--db", dbPath, "--max-age", "72h"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"snapshotId": "snap_fresh"');
    expect(result.stdout).toContain('"maxAgeMs": 259200000');
    expect(result.stdout).not.toContain("Refusing restore");
  });
});
