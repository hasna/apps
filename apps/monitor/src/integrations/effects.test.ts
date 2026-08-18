import { describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { digestOf, effectKey, FileEffectStore } from "./effects.js";
import type { EffectRecord } from "./adapter.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "monitor-effects-"));
}

function baseRecord(key: string): EffectRecord {
  return {
    effectKey: key,
    integration: "hooks",
    operation: "invoke",
    target: "gitguard",
    state: "confirmed",
    requestDigest: digestOf({ hookId: "gitguard", input: { hook_event_name: "PreToolUse" } }),
    externalId: null,
    resultPointer: digestOf({ exitCode: 0, stderr: "" }),
    lastErrorClass: null,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  };
}

describe("effectKey", () => {
  it("is a deterministic 64-char sha256 hex over the five stable components", () => {
    const req = { slug: "deploy-check", runId: "run-1", actionIndex: 2, target: "gitguard", operation: "invoke" };
    const a = effectKey(req);
    const b = effectKey(req);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any component changes", () => {
    const base = { slug: "deploy-check", runId: "run-1", actionIndex: 2, target: "gitguard", operation: "invoke" };
    expect(effectKey({ ...base, slug: "other" })).not.toBe(effectKey(base));
    expect(effectKey({ ...base, runId: "run-2" })).not.toBe(effectKey(base));
    expect(effectKey({ ...base, actionIndex: 3 })).not.toBe(effectKey(base));
    expect(effectKey({ ...base, target: "branchprotect" })).not.toBe(effectKey(base));
    expect(effectKey({ ...base, operation: "emit" })).not.toBe(effectKey(base));
  });
});

describe("digestOf", () => {
  it("is deterministic and value-sensitive", () => {
    expect(digestOf({ a: 1 })).toBe(digestOf({ a: 1 }));
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ a: 2 }));
    expect(digestOf({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("FileEffectStore", () => {
  it("persists a record across store instances", async () => {
    const dir = tempDir();
    const key = effectKey({ slug: "s", runId: "r", actionIndex: 0, target: "gitguard", operation: "invoke" });
    const record = baseRecord(key);

    const store = new FileEffectStore(dir);
    await store.record(record);

    const reopened = new FileEffectStore(dir);
    const got = await reopened.get(key);
    expect(got).toEqual(record);
  });

  it("returns null for an unknown effect key", async () => {
    const store = new FileEffectStore(tempDir());
    expect(await store.get("deadbeef".repeat(8))).toBeNull();
  });

  it("upserts by effect key: one record, updated state and timestamp, no duplicates", async () => {
    const dir = tempDir();
    const key = effectKey({ slug: "s", runId: "r", actionIndex: 0, target: "gitguard", operation: "invoke" });
    const first = baseRecord(key);
    const store = new FileEffectStore(dir);
    await store.record(first);

    const retried = { ...first, state: "unknown" as const, lastErrorClass: "timeout" as const, updatedAt: "2026-08-18T01:00:00.000Z" };
    await store.record(retried);

    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(1);
    const got = await store.get(key);
    expect(got?.state).toBe("unknown");
    expect(got?.lastErrorClass).toBe("timeout");
    expect(got?.updatedAt).toBe("2026-08-18T01:00:00.000Z");
  });

  it("writes effect files with mode 600", async () => {
    const dir = tempDir();
    const key = effectKey({ slug: "s", runId: "r", actionIndex: 0, target: "gitguard", operation: "invoke" });
    await new FileEffectStore(dir).record(baseRecord(key));
    const file = join(dir, `${key}.json`);
    const mode = statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
    // stored content is valid JSON matching the record
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(baseRecord(key));
  });
});
