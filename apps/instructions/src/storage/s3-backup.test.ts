import { describe, expect, test } from "bun:test";
import {
  buildInstructionsBackupKeys,
  planInstructionsBackupPush,
  pullInstructionsBackup,
  pushInstructionsBackup,
  verifyInstructionsBackup,
} from "./s3-backup.js";
import { memoryInstructionsObjectStore, type InstructionsObjectStore } from "./s3-object-store.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function countingStore(): InstructionsObjectStore & { calls: string[] } {
  const inner = memoryInstructionsObjectStore();
  const calls: string[] = [];
  return {
    calls,
    async put(key, bytes, options) { calls.push(`put:${key}`); return inner.put(key, bytes, options); },
    async get(key) { calls.push(`get:${key}`); return inner.get(key); },
    async head(key) { calls.push(`head:${key}`); return inner.head(key); },
    async delete(key) { calls.push(`delete:${key}`); return inner.delete(key); },
  };
}

describe("Instructions S3 backup primitives", () => {
  test("builds deterministic traversal-safe keys", () => {
    expect(buildInstructionsBackupKeys("instructions/", "backup 2026/09")).toEqual({
      rootKey: "instructions/backups/backup%202026%2F09",
      payloadKey: "instructions/backups/backup%202026%2F09/payload",
      manifestKey: "instructions/backups/backup%202026%2F09/manifest.json",
    });
    expect(() => buildInstructionsBackupKeys("instructions/", "..")).toThrow("backup id");
    expect(() => buildInstructionsBackupKeys("instructions/", "bad\\id")).toThrow("backup id");
  });

  test("plans a push without any object-store network operation", async () => {
    const store = countingStore();
    const plan = await planInstructionsBackupPush({
      store,
      prefix: "instructions/",
      backupId: "backup-1",
      bytes: encoder.encode("payload"),
      contentType: "application/json",
    });
    expect(plan).toMatchObject({
      operation: "push",
      dryRun: true,
      noNetwork: true,
      backupId: "backup-1",
      sizeBytes: 7,
    });
    expect(plan.sha256).toHaveLength(64);
    expect(store.calls).toEqual([]);
  });

  test("uploads immutable payload and sha256 manifest, then pulls and verifies", async () => {
    const store = countingStore();
    const pushed = await pushInstructionsBackup({
      store,
      prefix: "instructions/",
      backupId: "backup-1",
      bytes: encoder.encode("payload"),
      contentType: "application/json",
      createdAt: new Date("2026-09-15T00:00:00.000Z"),
    });

    expect(store.calls.filter((call) => call.startsWith("put:"))).toEqual([
      `put:${pushed.manifest.payloadKey}`,
      `put:${pushed.manifest.manifestKey}`,
    ]);
    expect(pushed.manifest).toMatchObject({
      schema: "hasna.instructions.backup-object/v1",
      app: "instructions",
      backupId: "backup-1",
      sizeBytes: 7,
      contentType: "application/json",
      createdAt: "2026-09-15T00:00:00.000Z",
    });
    expect(pushed.manifest.sha256).toHaveLength(64);

    const pulled = await pullInstructionsBackup({ store, prefix: "instructions/", backupId: "backup-1" });
    expect(decoder.decode(pulled.bytes)).toBe("payload");
    expect(await verifyInstructionsBackup({ store, prefix: "instructions/", backupId: "backup-1" })).toMatchObject({
      ok: true,
      sha256: pushed.manifest.sha256,
      sizeBytes: 7,
    });
  });

  test("identical replay is idempotent and differing bytes are refused", async () => {
    const store = countingStore();
    const input = {
      store,
      prefix: "instructions/",
      backupId: "backup-1",
      bytes: encoder.encode("payload"),
      createdAt: new Date("2026-09-15T00:00:00.000Z"),
    };
    const first = await pushInstructionsBackup(input);
    const writesAfterFirst = store.calls.filter((call) => call.startsWith("put:")).length;
    const second = await pushInstructionsBackup(input);
    expect(second.status).toBe("existing");
    expect(second.manifest).toEqual(first.manifest);
    expect(store.calls.filter((call) => call.startsWith("put:")).length).toBe(writesAfterFirst);

    await expect(pushInstructionsBackup({ ...input, bytes: encoder.encode("changed") })).rejects.toThrow("immutable");
  });

  test("does not accept an idempotent replay when the completed payload was lost", async () => {
    const store = memoryInstructionsObjectStore();
    const input = {
      store,
      prefix: "instructions/",
      backupId: "backup-1",
      bytes: encoder.encode("payload"),
      createdAt: new Date("2026-09-15T00:00:00.000Z"),
    };
    const result = await pushInstructionsBackup(input);
    await store.delete(result.manifest.payloadKey);
    await expect(pushInstructionsBackup(input)).rejects.toThrow("payload object is missing");
  });

  test("a manifest write failure leaves a retryable payload and a retry completes it", async () => {
    const inner = memoryInstructionsObjectStore();
    let failManifestOnce = true;
    const store: InstructionsObjectStore = {
      async put(key, bytes, options) {
        if (key.endsWith("/manifest.json") && failManifestOnce) {
          failManifestOnce = false;
          throw new Error("synthetic manifest failure");
        }
        await inner.put(key, bytes, options);
      },
      get: (key) => inner.get(key),
      head: (key) => inner.head(key),
      delete: (key) => inner.delete(key),
    };
    const input = {
      store,
      prefix: "instructions/",
      backupId: "backup-1",
      bytes: encoder.encode("payload"),
      createdAt: new Date("2026-09-15T00:00:00.000Z"),
    };
    await expect(pushInstructionsBackup(input)).rejects.toThrow("synthetic manifest failure");
    expect(inner.keys()).toEqual(["instructions/backups/backup-1/payload"]);
    expect((await pushInstructionsBackup(input)).status).toBe("created");
    expect(inner.keys()).toEqual([
      "instructions/backups/backup-1/manifest.json",
      "instructions/backups/backup-1/payload",
    ]);
  });

  test("detects corrupted payloads and manifests before returning bytes", async () => {
    const store = memoryInstructionsObjectStore();
    const result = await pushInstructionsBackup({
      store,
      prefix: "instructions/",
      backupId: "backup-1",
      bytes: encoder.encode("payload"),
    });
    await store.put(result.manifest.payloadKey, encoder.encode("corrupt"), { contentType: "application/octet-stream" });

    await expect(pullInstructionsBackup({ store, prefix: "instructions/", backupId: "backup-1" })).rejects.toThrow("integrity");
    await expect(verifyInstructionsBackup({ store, prefix: "instructions/", backupId: "backup-1" })).rejects.toThrow("integrity");

    await store.put(result.manifest.manifestKey, encoder.encode("{not-json"), { contentType: "application/json" });
    await expect(pullInstructionsBackup({ store, prefix: "instructions/", backupId: "backup-1" })).rejects.toThrow("manifest");
  });

  test("requires both manifest and payload and never treats S3 as a database", async () => {
    const store = memoryInstructionsObjectStore();
    await expect(pullInstructionsBackup({ store, prefix: "instructions/", backupId: "missing" })).rejects.toThrow("manifest object is missing");

    const keys = buildInstructionsBackupKeys("instructions/", "incomplete");
    await store.put(keys.manifestKey, encoder.encode(JSON.stringify({
      schema: "hasna.instructions.backup-object/v1",
      app: "instructions",
      backupId: "incomplete",
      payloadKey: keys.payloadKey,
      manifestKey: keys.manifestKey,
      sha256: "0".repeat(64),
      sizeBytes: 0,
      contentType: "application/octet-stream",
      createdAt: "2026-09-15T00:00:00.000Z",
    })), { contentType: "application/json" });
    await expect(pullInstructionsBackup({ store, prefix: "instructions/", backupId: "incomplete" })).rejects.toThrow("payload object is missing");
  });
});
