import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createRunRecord } from "./run-records.js";
import {
  ENV_SNAPSHOT_SCHEMA,
  buildEnvSnapshotPayload,
  captureEnvSnapshot,
  getEnvSnapshot,
  listEnvSnapshots,
  checkEnvSnapshot,
  computeSnapshotHash,
} from "./environment-snapshots.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
  delete process.env["TODOS_MACHINE_ID"];
});

describe("environment snapshots", () => {
  it("builds payload with schema and command versions", () => {
    const payload = buildEnvSnapshotPayload({ cwd: process.cwd(), commands: ["node"] });
    expect(payload.schema_version).toBe(ENV_SNAPSHOT_SCHEMA);
    expect(payload.cwd).toBe(process.cwd());
    expect(payload.commands.some((c) => c.name === "node")).toBe(true);
    expect(payload.os.platform).toBeTruthy();
  });

  it("captures and retrieves snapshot", () => {
    const run = createRunRecord({ objective: "env test" });
    const record = captureEnvSnapshot({ run_record_id: run.id });
    expect(record.id).toBeTruthy();
    expect(record.run_record_id).toBe(run.id);
    expect(record.content_hash).toHaveLength(64);

    const loaded = getEnvSnapshot(record.id);
    expect(loaded?.snapshot.schema_version).toBe(ENV_SNAPSHOT_SCHEMA);
    expect(loaded?.content_hash).toBe(record.content_hash);
  });

  it("lists snapshots by run_record_id", () => {
    const runA = createRunRecord({ objective: "a" });
    const runB = createRunRecord({ objective: "b" });
    captureEnvSnapshot({ run_record_id: runA.id });
    captureEnvSnapshot({ run_record_id: runB.id });
    captureEnvSnapshot({ run_record_id: runA.id });

    const listed = listEnvSnapshots({ run_record_id: runA.id });
    expect(listed).toHaveLength(2);
  });

  it("checks snapshot without inserting a new row", () => {
    const record = captureEnvSnapshot();
    const beforeCount = (getDatabase().query("SELECT COUNT(*) as c FROM env_snapshots").get() as { c: number }).c;

    const check = checkEnvSnapshot(record.id);
    const afterCount = (getDatabase().query("SELECT COUNT(*) as c FROM env_snapshots").get() as { c: number }).c;

    expect(afterCount).toBe(beforeCount);
    expect(check.matches).toBe(true);
    expect(check.drift).toHaveLength(0);
  });

  it("computes stable hash for payload", () => {
    const payload = buildEnvSnapshotPayload({ commands: [] });
    const h1 = computeSnapshotHash(payload);
    const h2 = computeSnapshotHash({ ...payload });
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
});
