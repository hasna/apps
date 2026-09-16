import { describe, expect, test } from "bun:test";
import {
  buildInstructionsBackupKeys,
  planInstructionsBackupPush,
  pullInstructionsBackup,
  pushInstructionsBackup,
  verifyInstructionsBackup,
} from "./s3-backup.js";
import type {
  InstructionsObjectCreateResult,
  InstructionsObjectMetadata,
  InstructionsObjectReadOptions,
  InstructionsObjectStore,
} from "./s3-object-store.js";

const encoder = new TextEncoder();

interface FixtureStore extends InstructionsObjectStore {
  calls: string[];
  keys(): string[];
  shadow(key: string, bytes: Uint8Array, contentType?: string): string;
  remove(key: string): void;
}

function fixtureStore(): FixtureStore {
  type Entry = { versionId: string; bytes: Uint8Array; contentType: string; createdAt: Date };
  const versions = new Map<string, Entry[]>();
  const calls: string[] = [];
  let sequence = 1;
  const select = (key: string, options?: InstructionsObjectReadOptions): Entry | undefined => {
    const entries = versions.get(key) ?? [];
    return options?.versionId
      ? entries.find((entry) => entry.versionId === options.versionId)
      : entries.at(-1);
  };
  const add = (key: string, bytes: Uint8Array, contentType: string): Entry => {
    const entry = { versionId: `fixture-v${sequence++}`, bytes: Uint8Array.from(bytes), contentType, createdAt: new Date() };
    versions.set(key, [...(versions.get(key) ?? []), entry]);
    return entry;
  };
  return {
    calls,
    async putIfAbsent(key, bytes, options): Promise<InstructionsObjectCreateResult> {
      calls.push(`putIfAbsent:${key}`);
      const current = select(key);
      if (current) return { status: "existing", versionId: current.versionId };
      const created = add(key, bytes, options.contentType);
      return { status: "created", versionId: created.versionId };
    },
    async get(key, options) {
      calls.push(`get:${key}:${options?.versionId ?? "current"}`);
      const entry = select(key, options);
      return entry ? Uint8Array.from(entry.bytes) : undefined;
    },
    async head(key, options): Promise<InstructionsObjectMetadata | undefined> {
      calls.push(`head:${key}:${options?.versionId ?? "current"}`);
      const entry = select(key, options);
      return entry ? {
        size: entry.bytes.byteLength,
        contentType: entry.contentType,
        lastModified: new Date(entry.createdAt),
        versionId: entry.versionId,
      } : undefined;
    },
    shadow(key, bytes, contentType = "application/octet-stream") {
      return add(key, bytes, contentType).versionId;
    },
    remove(key) { versions.delete(key); },
    keys() { return [...versions.keys()].sort(); },
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

  test("plans a push without any object-store operation", async () => {
    const store = fixtureStore();
    const plan = await planInstructionsBackupPush({
      store,
      prefix: "instructions/",
      backupId: "backup-1",
      bytes: encoder.encode("payload"),
      contentType: "application/json",
    });
    expect(plan).toMatchObject({ operation: "push", dryRun: true, noNetwork: true, backupId: "backup-1", sizeBytes: 7 });
    expect(plan.sha256).toHaveLength(64);
    expect(store.calls).toEqual([]);
  });

  test("records both immutable object versions and verifies the exact versions", async () => {
    const store = fixtureStore();
    const pushed = await pushInstructionsBackup({
      store,
      prefix: "instructions/",
      backupId: "backup-1",
      bytes: encoder.encode("payload"),
      contentType: "application/json",
      createdAt: new Date("2026-09-16T00:00:00.000Z"),
    });
    expect(pushed.status).toBe("created");
    expect(pushed.versions).toEqual({ payloadVersionId: "fixture-v1", manifestVersionId: "fixture-v2" });

    const pinned = {
      store,
      prefix: "instructions/",
      backupId: "backup-1",
      ...pushed.versions!,
    };
    const pulled = await pullInstructionsBackup(pinned);
    expect(new TextDecoder().decode(pulled.bytes)).toBe("payload");
    expect(pulled.versionPinned).toBe(true);
    expect(pulled.versions).toEqual(pushed.versions);
    expect(await verifyInstructionsBackup(pinned)).toMatchObject({
      ok: true,
      sha256: pushed.manifest.sha256,
      sizeBytes: 7,
      versionPinned: true,
      versions: pushed.versions,
    });
  });

  test("version-pinned verification remains authoritative after later shadow versions", async () => {
    const store = fixtureStore();
    const pushed = await pushInstructionsBackup({
      store,
      prefix: "instructions/",
      backupId: "retained",
      bytes: encoder.encode("retained payload"),
      createdAt: new Date("2026-09-16T00:00:00.000Z"),
    });
    if (!pushed.versions) throw new Error("fixture must return versions");

    store.shadow(pushed.manifest.payloadKey, encoder.encode("shadow payload"));
    store.shadow(pushed.manifest.manifestKey, encoder.encode("{\"shadow\":true}\n"), "application/json");

    await expect(verifyInstructionsBackup({ store, prefix: "instructions/", backupId: "retained" })).rejects.toThrow("manifest");
    const verified = await verifyInstructionsBackup({
      store,
      prefix: "instructions/",
      backupId: "retained",
      ...pushed.versions,
    });
    expect(verified.versionPinned).toBe(true);
    expect(verified.versions).toEqual(pushed.versions);
    expect(verified.sha256).toBe(pushed.manifest.sha256);
  });

  test("requires payload and manifest version ids as one recovery authority", async () => {
    const store = fixtureStore();
    await expect(pullInstructionsBackup({
      store,
      prefix: "instructions/",
      backupId: "backup-1",
      payloadVersionId: "payload-v1",
    })).rejects.toThrow("provided together");
    await expect(verifyInstructionsBackup({
      store,
      prefix: "instructions/",
      backupId: "backup-1",
      manifestVersionId: "manifest-v1",
    })).rejects.toThrow("provided together");
    expect(store.calls).toEqual([]);
  });

  test("concurrent same-id writers cannot replace the immutable winner", async () => {
    const store = fixtureStore();
    let manifestReads = 0;
    let releaseFirst: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const originalGet = store.get.bind(store);
    store.get = async (key, options) => {
      if (key.endsWith("/manifest.json") && !options?.versionId && manifestReads < 2) {
        manifestReads += 1;
        if (manifestReads === 1) await gate;
        else releaseFirst?.();
        return undefined;
      }
      return originalGet(key, options);
    };
    const firstBytes = encoder.encode("first contender");
    const secondBytes = encoder.encode("second contender");
    const results = await Promise.allSettled([
      pushInstructionsBackup({ store, prefix: "instructions/", backupId: "concurrent", bytes: firstBytes, createdAt: new Date("2026-09-16T00:00:00.000Z") }),
      pushInstructionsBackup({ store, prefix: "instructions/", backupId: "concurrent", bytes: secondBytes, createdAt: new Date("2026-09-16T00:00:01.000Z") }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  test("identical replay is idempotent and differing bytes are refused", async () => {
    const store = fixtureStore();
    const input = { store, prefix: "instructions/", backupId: "backup-1", bytes: encoder.encode("payload"), createdAt: new Date("2026-09-16T00:00:00.000Z") };
    const first = await pushInstructionsBackup(input);
    const createsAfterFirst = store.calls.filter((call) => call.startsWith("putIfAbsent:")).length;
    const second = await pushInstructionsBackup(input);
    expect(second.status).toBe("existing");
    expect(second.manifest).toEqual(first.manifest);
    expect(second.versions).toEqual(first.versions);
    expect(store.calls.filter((call) => call.startsWith("putIfAbsent:")).length).toBe(createsAfterFirst);
    await expect(pushInstructionsBackup({ ...input, bytes: encoder.encode("changed") })).rejects.toThrow("immutable");
  });

  test("does not accept replay when the completed payload is missing", async () => {
    const store = fixtureStore();
    const input = { store, prefix: "instructions/", backupId: "backup-1", bytes: encoder.encode("payload") };
    const result = await pushInstructionsBackup(input);
    store.remove(result.manifest.payloadKey);
    await expect(pushInstructionsBackup(input)).rejects.toThrow("payload object is missing");
  });

  test("a manifest create failure leaves a retryable payload", async () => {
    const store = fixtureStore();
    const originalCreate = store.putIfAbsent!.bind(store);
    let failManifestOnce = true;
    store.putIfAbsent = async (key, bytes, options) => {
      if (key.endsWith("/manifest.json") && failManifestOnce) {
        failManifestOnce = false;
        throw new Error("synthetic manifest failure");
      }
      return originalCreate(key, bytes, options);
    };
    const input = { store, prefix: "instructions/", backupId: "backup-1", bytes: encoder.encode("payload") };
    await expect(pushInstructionsBackup(input)).rejects.toThrow("synthetic manifest failure");
    expect(store.keys()).toEqual(["instructions/backups/backup-1/payload"]);
    expect((await pushInstructionsBackup(input)).status).toBe("created");
  });

  test("detects corrupted current payloads and manifests", async () => {
    const store = fixtureStore();
    const result = await pushInstructionsBackup({ store, prefix: "instructions/", backupId: "backup-1", bytes: encoder.encode("payload") });
    store.shadow(result.manifest.payloadKey, encoder.encode("corrupt"));
    await expect(pullInstructionsBackup({ store, prefix: "instructions/", backupId: "backup-1" })).rejects.toThrow("integrity");
    store.shadow(result.manifest.manifestKey, encoder.encode("{not-json"), "application/json");
    await expect(pullInstructionsBackup({ store, prefix: "instructions/", backupId: "backup-1" })).rejects.toThrow("manifest");
  });

  test("fails closed without atomic create support", async () => {
    const store = fixtureStore();
    const nonAtomicStore: InstructionsObjectStore = { get: store.get.bind(store), head: store.head.bind(store) };
    await expect(pushInstructionsBackup({ store: nonAtomicStore, prefix: "instructions/", backupId: "must-be-atomic", bytes: encoder.encode("payload") })).rejects.toThrow("does not support atomic immutable creation");
    expect(store.keys()).toEqual([]);
  });

  test("requires both manifest and payload and never treats S3 as a database", async () => {
    const store = fixtureStore();
    await expect(pullInstructionsBackup({ store, prefix: "instructions/", backupId: "missing" })).rejects.toThrow("manifest object is missing");
    const keys = buildInstructionsBackupKeys("instructions/", "incomplete");
    store.shadow(keys.manifestKey, encoder.encode(JSON.stringify({
      schema: "hasna.instructions.backup-object/v1",
      app: "instructions",
      backupId: "incomplete",
      payloadKey: keys.payloadKey,
      manifestKey: keys.manifestKey,
      sha256: "0".repeat(64),
      sizeBytes: 0,
      contentType: "application/octet-stream",
      createdAt: "2026-09-16T00:00:00.000Z",
    })), "application/json");
    await expect(pullInstructionsBackup({ store, prefix: "instructions/", backupId: "incomplete" })).rejects.toThrow("payload object is missing");
  });
});
