// Hermetic regression tests for the hosted (API-mode) arms of commands that
// previously hit the getDatabase() split-brain guard — the storage-mode axis
// is retired, so every command must work in ANY transport:
//
//   - `backup`          — must snapshot the cloud store through the API into
//                         the portable backup file, never a stale local island
//   - `synthesis run/rollback` — must route to the server (the client has no
//                         db; the old code opened one and crashed)
//   - `session ingest`  — must ship the transcript to the server-side queue
//
// All runs are pointed at a loopback stub server (separate process, the real
// curl child would deadlock an in-process server) via apiModeTestEnv, which
// scrubs every store selector first — a hosted write or a local DB open here
// would be a test defect, not just a failed assertion.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
import {
  startTransportBatteryStubProcess,
  waitForTransportBatteryStub,
  apiModeTestEnv,
  type TransportBatteryStubProcess,
} from "../../test-support/transport-battery-stub.js";

const CLI_PATH = new URL("../index.tsx", import.meta.url).pathname;

let stub: TransportBatteryStubProcess;

beforeAll(async () => {
  stub = startTransportBatteryStubProcess();
  await waitForTransportBatteryStub(stub.baseUrl);
});

afterAll(() => {
  stub.stop();
});

async function runCli(
  args: string[],
  outPath: string,
  errPath: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    env: apiModeTestEnv(stub.baseUrl),
    stdout: Bun.file(outPath),
    stderr: Bun.file(errPath),
  });
  const exitCode = await proc.exited;
  return {
    exitCode,
    stdout: existsSync(outPath) ? (await Bun.file(outPath).text()).trim() : "",
    stderr: existsSync(errPath) ? (await Bun.file(errPath).text()).trim() : "",
  };
}

function scratchFiles(tag: string): { out: string; err: string; cleanup(): void } {
  const out = join(tmpdir(), `mementos-tb-${tag}-${Date.now()}-${Math.random()}.out`);
  const err = join(tmpdir(), `mementos-tb-${tag}-${Date.now()}-${Math.random()}.err`);
  return {
    out,
    err,
    cleanup() {
      for (const f of [out, err]) if (existsSync(f)) unlinkSync(f);
    },
  };
}

describe("hosted transport arms — commands that must not open a local store in API mode", () => {
  test("`backup` snapshots the cloud population through the API into the portable backup file", async () => {
    const backupPath = join(tmpdir(), `mementos-tb-backup-${Date.now()}-${Math.random()}.db`);
    const files = scratchFiles("backup");
    const { exitCode, stdout, stderr } = await runCli(["backup", backupPath], files.out, files.err);
    files.cleanup();

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("split-brain");
    expect(stderr).not.toContain("Database not found");
    expect(stdout).toContain("Backed up to");
    expect(existsSync(backupPath)).toBe(true);
    try {
      const db = new Database(backupPath, { readonly: true });
      try {
        const count = (db.query("SELECT COUNT(*) as c FROM memories").get() as { c: number }).c;
        expect(count).toBe(5);
        const first = db
          .query("SELECT key, value FROM memories ORDER BY id LIMIT 1")
          .get() as { key: string; value: string } | null;
        expect(first?.key).toBe("stub-key-0");
        expect(first?.value).toBe("stub value 0");
      } finally {
        db.close();
      }
    } finally {
      unlinkSync(backupPath);
    }
  });

  test("`synthesis run --dry-run` routes to the server and prints the run id", async () => {
    const files = scratchFiles("synth-run");
    const { exitCode, stdout, stderr } = await runCli(
      ["synthesis", "run", "--dry-run", "--max-proposals", "3"],
      files.out,
      files.err,
    );
    files.cleanup();
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("split-brain");
    expect(stdout).toContain("stub-run-0001");
    expect(stdout).toContain("proposals generated");
  });

  test("`synthesis rollback <id>` routes to the server rollback endpoint", async () => {
    const files = scratchFiles("synth-rollback");
    const { exitCode, stdout, stderr } = await runCli(
      ["synthesis", "rollback", "whatever-run"],
      files.out,
      files.err,
    );
    files.cleanup();
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("split-brain");
    expect(stdout).toContain("Rolled back 1 proposals");
  });

  test("`session ingest` ships the transcript to the server-side queue", async () => {
    const transcript = join(tmpdir(), `mementos-tb-transcript-${Date.now()}.md`);
    writeFileSync(transcript, "# transcript\nUser: hi\n");
    const files = scratchFiles("ingest");
    const { exitCode, stdout, stderr } = await runCli(
      ["session", "ingest", transcript, "--session-id", "tb-session"],
      files.out,
      files.err,
    );
    unlinkSync(transcript);
    files.cleanup();
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("split-brain");
    expect(stdout).toContain("stub-job-0001");
    expect(stdout).toContain("hosted store");
  });
});