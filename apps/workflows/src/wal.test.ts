/**
 * Regression tests for the session WAL (slice C): append-only JSONL with
 * per-entry checksums, torn-tail detection, truncation repair, and replay.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionWAL, SESSIONS_DIR_NAME, WAL_FILE_NAME, type WalOp, type WalReplay } from "./wal.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "workflows-wal-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const op = (runId: string): WalOp => ({ op: "run_started", runId, at: new Date().toISOString() });

describe("SessionWAL", () => {
  test("appends and replays entries with increasing sequence numbers", () => {
    const wal = SessionWAL.open(dir);
    const e1 = wal.append(op("r1"));
    const e2 = wal.append(op("r2"));
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    wal.close();

    const wal2 = SessionWAL.open(dir);
    const replay = wal2.replay();
    expect(replay.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(replay.entries.map((e) => e.op.op)).toEqual(["run_started", "run_started"]);
    expect(replay.torn).toBe(false);
    wal2.close();
  });

  test("detects a torn tail (partial line) and truncates it", () => {
    const wal = SessionWAL.open(dir);
    wal.append(op("r1"));
    wal.close();
    // simulate a crash mid-write: a partial line appended without a newline
    writeFileSync(wal.filePath, readFileSync(wal.filePath) + '{"seq":2,"at":"2026-01-01T00:00:00.000Z"', "utf8");

    const wal2 = SessionWAL.open(dir);
    const replay = wal2.replay();
    expect(replay.entries.length).toBe(1);
    expect(replay.torn).toBe(true);
    expect(replay.repaired).toBe(true);
    // the torn tail is gone; the file is replayable again
    const replay3 = wal2.replay();
    expect(replay3.entries.length).toBe(1);
    expect(replay3.torn).toBe(false);
    wal2.close();
  });

  test("detects a checksum mismatch (corrupted entry) and truncates from it", () => {
    const wal = SessionWAL.open(dir);
    wal.append(op("r1"));
    wal.append(op("r2"));
    wal.close();
    // corrupt the second line in place
    const file = wal.filePath;
    const lines = readFileSync(file, "utf8").split("\n");
    const corrupted = lines[1].replace('"run_started"', '"node_started"');
    writeFileSync(file, lines[0] + "\n" + corrupted + "\n", "utf8");

    const wal2 = SessionWAL.open(dir);
    const replay = wal2.replay();
    expect(replay.entries.length).toBe(1);
    expect(replay.torn).toBe(true);
    expect(replay.repaired).toBe(true);
    // subsequent appends continue from the surviving sequence
    const e = wal2.append(op("r3"));
    expect(e.seq).toBe(2);
    expect(wal2.replay().entries.map((x) => x.seq)).toEqual([1, 2]);
    wal2.close();
  });

  test("replays claim lifecycle ops for liveness reconstruction", () => {
    const wal = SessionWAL.open(dir);
    wal.append({ op: "claim_acquired", runId: "r1", worker: "w1", expiresAt: new Date(Date.now() + 60000).toISOString(), fencing: 1, at: new Date().toISOString() });
    wal.close();
    const replay: WalReplay = SessionWAL.open(dir).replay();
    const claims = replay.liveClaims();
    expect(claims.get("r1")?.worker).toBe("w1");
    expect(claims.get("r1")?.fencing).toBe(1);
    expect(claims.get("r1")!.expiresAtMs).toBeGreaterThan(Date.now());
  });

  test("a released claim is not live", () => {
    const wal = SessionWAL.open(dir);
    const now = new Date();
    wal.append({ op: "claim_acquired", runId: "r1", worker: "w1", expiresAt: new Date(Date.now() + 60000).toISOString(), fencing: 1, at: now.toISOString() });
    wal.append({ op: "claim_released", runId: "r1", fencing: 1, at: now.toISOString() });
    const replay = SessionWAL.open(dir).replay();
    expect(replay.liveClaims().has("r1")).toBe(false);
  });

  test("an expired claim is not live", () => {
    const wal = SessionWAL.open(dir);
    wal.append({ op: "claim_acquired", runId: "r1", worker: "w1", expiresAt: new Date(Date.now() - 1000).toISOString(), fencing: 1, at: new Date().toISOString() });
    const replay = SessionWAL.open(dir).replay();
    expect(replay.liveClaims().has("r1")).toBe(false);
  });

  test("the WAL lives at sessions/session.wal per the data-dir layout", () => {
    const wal = SessionWAL.open(dir);
    wal.append(op("r1"));
    wal.close();
    expect(wal.filePath).toBe(join(dir, SESSIONS_DIR_NAME, WAL_FILE_NAME));
    expect(readFileSync(wal.filePath, "utf8").length).toBeGreaterThan(0);
    // the legacy data-dir-root location must NOT be written
    expect(existsSync(join(dir, WAL_FILE_NAME))).toBe(false);
  });

  test("a legacy root-level WAL is migrated into sessions/ so no claim history is lost", () => {
    const legacy = join(dir, WAL_FILE_NAME);
    const legacyWal = SessionWAL.openAt(legacy);
    legacyWal.append({ op: "claim_acquired", runId: "r1", worker: "w1", expiresAt: new Date(Date.now() + 60000).toISOString(), fencing: 1, at: new Date().toISOString() });
    legacyWal.close();
    // open() migrates the legacy file into sessions/session.wal
    const wal = SessionWAL.open(dir);
    const replay = wal.replay();
    expect(replay.entries.length).toBe(1);
    expect(replay.liveClaims().has("r1")).toBe(true);
    expect(existsSync(legacy)).toBe(false);
  });
});
