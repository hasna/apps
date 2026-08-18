import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDb } from "../src/db.js";
import { getDb } from "../src/db.js";
import { encrypt } from "../src/crypto.js";
import { _resetLocalMasterKey } from "../src/crypto.js";
import { LocalStore } from "../src/store/index.js";
import { MetadataValidationError, VersionConflictError, VersionNotFoundError } from "../src/store/types.js";
import type { RestoreVersionOptions } from "../src/types.js";
import { MAX_METADATA_LENGTH } from "../src/metadata.js";
import { MAX_VERSIONS_PER_KEY } from "../src/types.js";

const _store = new LocalStore();
const setSecret = _store.setSecret.bind(_store);
const getSecret = _store.getSecret.bind(_store);
const listVersions = _store.listVersions.bind(_store);
const checkVersion = _store.checkVersion.bind(_store);
const restoreVersion = _store.restoreVersion.bind(_store);
const pruneVersionHistory = _store.pruneVersionHistory.bind(_store);
const runVersionBackfill = _store.runVersionBackfill.bind(_store);

// Deliberately NOT secret-shaped (no sk- prefix, no token pattern) so the
// staged scanner stays clean while an accidental print is still detectable.
const SENTINEL = "sentinel-v7f3a9c21e8-value";
// Credential-shaped metadata is assembled at runtime so this file does not
// itself carry a literal credential shape (the repo's staged scan would trip).
// Named `concat`, never `join`, which would shadow node:path's join above and
// break `rootDir` resolution.
const concat = (...parts: string[]): string => parts.join("");
const CRED_SHAPED = concat("sk-synth", "etic-value-", "9f8e7d6c5b4a3f2e1d0c");
const rootDir = join(import.meta.dir, "..");

let testDir: string;
let dbPath: string;
let keyDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), "secrets-versioning-test", `vt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  dbPath = join(testDir, "vault.db");
  // Pin the local master-key dir so CLI children spawned by value-safety tests
  // share the same key as this process (the default test key dir is
  // per-process random, which would make the child unable to decrypt).
  keyDir = join(testDir, "keys");
  mkdirSync(keyDir, { recursive: true });
  process.env.OPEN_SECRETS_DB = dbPath;
  process.env.HASNA_SECRETS_KEY_DIR = keyDir;
  // The local master key is cached in module state; without this reset a test
  // using a fresh key dir would still encrypt with the previous test's key,
  // which CLI children (fresh processes, fresh key file) cannot decrypt.
  _resetLocalMasterKey();
  resetDb();
});

afterEach(async () => {
  resetDb();
  _resetLocalMasterKey();
  delete process.env.OPEN_SECRETS_DB;
  delete process.env.HASNA_SECRETS_KEY_DIR;
  rmSync(testDir, { recursive: true, force: true });
});

async function runCli(args: string[], stdinText?: string) {
  const proc = Bun.spawn({
    cmd: ["bun", "src/index.ts", ...args],
    cwd: rootDir,
    env: {
      ...process.env,
      OPEN_SECRETS_DB: dbPath,
      HASNA_SECRETS_KEY_DIR: keyDir,
      NO_COLOR: "1",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdinText !== undefined) {
    proc.stdin.write(stdinText);
  }
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("secret versioning — positive fixtures", () => {
  it("set on a fresh key shows version 1 (initial)", async () => {
    const entry = await setSecret("fixture/basic", SENTINEL, "other");
    expect(entry.version).toBe(1);
    expect(entry.unchanged).toBe(false);
    const versions = await listVersions("fixture/basic");
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version: 1,
      change_kind: "initial",
      current: true,
      value_length: SENTINEL.length,
    });
    expect(versions[0].fingerprint).toMatch(/^[0-9a-f]{16}$/);
    // Metadata-only: no value material in the projection.
    const serialized = JSON.stringify(versions[0]);
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain("value_blob");
  });

  it("set with a different value and a reason creates monotonically increasing version 2", async () => {
    await setSecret("fixture/basic", "first-value", "other");
    const entry = await setSecret("fixture/basic", SENTINEL, "other", undefined, undefined, {
      reason: "rotated after compromise",
    });
    expect(entry.version).toBe(2);
    const versions = await listVersions("fixture/basic");
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({
      change_kind: "set",
      reason: "rotated after compromise",
      current: true,
    });
    expect(versions[1]).toMatchObject({ change_kind: "initial", current: false });
    expect((await getSecret("fixture/basic"))!.value).toBe(SENTINEL);
  });

  it("set with the same value creates no new version and reports unchanged", async () => {
    await setSecret("fixture/basic", SENTINEL, "other");
    const entry = await setSecret("fixture/basic", SENTINEL, "other", undefined, undefined, {
      reason: "noise that must not create a version",
    });
    expect(entry.unchanged).toBe(true);
    expect(entry.version).toBe(1);
    const versions = await listVersions("fixture/basic");
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
  });

  it("restore appends a new current version and never rewinds history", async () => {
    await setSecret("fixture/basic", "original-value", "other");
    await setSecret("fixture/basic", SENTINEL, "other");
    const before = await listVersions("fixture/basic");
    expect(before.map((v) => v.version)).toEqual([2, 1]);

    const restored = await restoreVersion("fixture/basic", 1, { reason: "bad rotation, roll back", expectCurrent: 2 });
    expect(restored.version).toBe(3);
    expect(restored.current).toBe(true);
    expect(restored.change_kind).toBe("restore");
    expect(restored.source_version).toBe(1);

    // The current value served by get/exec matches version 1's value.
    expect((await getSecret("fixture/basic"))!.value).toBe("original-value");
    // History is append-only: versions 1 and 2 remain untouched.
    const after = await listVersions("fixture/basic");
    expect(after.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(after.find((v) => v.version === 1)).toMatchObject({ current: false });
    expect(after.find((v) => v.version === 1)?.source_version).toBeUndefined();
    expect(after.find((v) => v.version === 2)).toMatchObject({ current: false });
    // The restored value's evidence matches the source version's evidence.
    const v1 = await checkVersion("fixture/basic", 1);
    const v3 = await checkVersion("fixture/basic", 3);
    expect(v3.hash).toBe(v1.hash);
    expect(v3.value_length).toBe(v1.value_length);
  });

  it("restore can succeed when the client never receives the historical value", async () => {
    await setSecret("fixture/basic", "original-value", "other");
    await setSecret("fixture/basic", SENTINEL, "other");
    const restored = await restoreVersion("fixture/basic", 1, { reason: "roll back", expectCurrent: 2 });
    const serialized = JSON.stringify(restored);
    expect(serialized).not.toContain("original-value");
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain("value_blob");
  });

  it("checkVersion returns the same evidence class as get --check (comparable sha256)", async () => {
    await setSecret("fixture/basic", SENTINEL, "other");
    const check = await checkVersion("fixture/basic", 1);
    expect(check.version).toBe(1);
    expect(check.current).toBe(true);
    expect(check.value_length).toBe(SENTINEL.length);
    expect(check.hash).toMatch(/^[0-9a-f]{64}$/);
    // Compare with the get --check contract (sha256 of the plaintext).
    const { createHash } = await import("node:crypto");
    expect(check.hash).toBe(createHash("sha256").update(SENTINEL).digest("hex"));
    const serialized = JSON.stringify(check);
    expect(serialized).not.toContain(SENTINEL);
  });

  it("migration backfill makes every existing value version 1 exactly once; a second run is a no-op", async () => {
    // Simulate a pre-upgrade vault: raw secrets rows with no version history.
    const db = getDb();
    db.prepare(
      "INSERT INTO secrets (key, value, type, label, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("legacy/one", encrypt("legacy-value-one"), "other", null, null, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    db.prepare(
      "INSERT INTO secrets (key, value, type, label, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("legacy/two", encrypt("legacy-value-two"), "other", null, null, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");

    expect(await runVersionBackfill()).toBe(2);
    // A second run is a no-op (UNIQUE(key, version) + existence check).
    expect(await runVersionBackfill()).toBe(0);

    for (const key of ["legacy/one", "legacy/two"]) {
      const versions = await listVersions(key);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        version: 1,
        change_kind: "migration",
        reason: "baseline current value",
        created_by: "system:migration",
        current: true,
      });
    }

    // A pre-upgrade key keeps its baseline: same value → unchanged; new value → v2.
    const unchanged = await setSecret("legacy/one", "legacy-value-one", "other");
    expect(unchanged.unchanged).toBe(true);
    expect(unchanged.version).toBe(1);
    const changed = await setSecret("legacy/one", "rotated-value", "other", undefined, undefined, {
      reason: "post-upgrade rotation",
    });
    expect(changed.version).toBe(2);
    expect(changed.unchanged).toBe(false);
    expect((await listVersions("legacy/one")).map((v) => v.version)).toEqual([2, 1]);
  });

  it("retention truncation: at most 20 versions per key, current always kept, superseded age bound", async () => {
    for (let i = 1; i <= 25; i++) {
      await setSecret("fixture/highchurn", `value-${i}`, "other", undefined, undefined, {
        reason: `write ${i}`,
      });
    }
    // The per-write retention already capped the table at the newest 20.
    const versions = await listVersions("fixture/highchurn", 100);
    expect(versions).toHaveLength(MAX_VERSIONS_PER_KEY);
    expect(versions[0].version).toBe(25); // current kept
    expect(versions.at(-1)!.version).toBe(6); // oldest surviving
    expect(versions.every((v) => v.current === (v.version === 25))).toBe(true);

    // Backdate a superseded version past the 180-day window and sweep.
    const db = getDb();
    const oldCutoff = new Date(Date.now() - 200 * 86_400_000).toISOString();
    db.prepare("UPDATE secret_versions SET created_at = ? WHERE key = ? AND version = 6").run(oldCutoff, "fixture/highchurn");
    const result = await pruneVersionHistory();
    expect(result.versions).toBe(1);

    const after = await listVersions("fixture/highchurn", 100);
    expect(after.map((v) => v.version)).not.toContain(6);
    expect(after.map((v) => v.version)).toContain(25); // current survives age pruning
    expect(after).toHaveLength(19);
  });
});

describe("secret versioning — negative fixtures", () => {
  it("restore of a nonexistent key or version errors and performs zero mutation", async () => {
    await setSecret("fixture/basic", "v1", "other");
    await setSecret("fixture/basic", "v2", "other");

    await expect(restoreVersion("missing/key", 1, { reason: "x", expectCurrent: 2 })).rejects.toBeInstanceOf(VersionNotFoundError);
    await expect(restoreVersion("fixture/basic", 99, { reason: "x", expectCurrent: 2 })).rejects.toBeInstanceOf(VersionNotFoundError);
    // Zero mutation: current value and history are untouched.
    expect((await getSecret("fixture/basic"))!.value).toBe("v2");
    expect((await listVersions("fixture/basic")).map((v) => v.version)).toEqual([2, 1]);
  });

  it("restore with a stale expected-current returns a conflict and performs zero mutation", async () => {
    await setSecret("fixture/basic", "v1", "other");
    await setSecret("fixture/basic", "v2", "other");
    await expect(restoreVersion("fixture/basic", 1, { reason: "stale", expectCurrent: 1 })).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    // Zero mutation: no new version, current value unchanged.
    expect((await getSecret("fixture/basic"))!.value).toBe("v2");
    expect((await listVersions("fixture/basic")).map((v) => v.version)).toEqual([2, 1]);
    expect((await listVersions("fixture/basic")).find((v) => v.version === 2)!.current).toBe(true);
  });

  it("restore without a reason is refused", async () => {
    await setSecret("fixture/basic", "v1", "other");
    await expect(restoreVersion("fixture/basic", 1, { reason: " ", expectCurrent: 2 })).rejects.toThrow(/reason is required/);
  });

  it("checkVersion of a nonexistent version errors without value material", async () => {
    await setSecret("fixture/basic", "v1", "other");
    await expect(checkVersion("fixture/basic", 7)).rejects.toBeInstanceOf(VersionNotFoundError);
    await expect(checkVersion("missing/key", 1)).rejects.toBeInstanceOf(VersionNotFoundError);
  });
});

describe("restore CAS is mandatory (P1-1)", () => {
  it("restore without expected_current_version is refused before any read or write", async () => {
    await setSecret("fixture/basic", "v1", "other");
    await setSecret("fixture/basic", "v2", "other");
    await expect(
      restoreVersion("fixture/basic", 1, { reason: "x" } as unknown as RestoreVersionOptions),
    ).rejects.toThrow(/expected_current_version is required/);
    // Zero mutation: history and served value untouched.
    expect((await getSecret("fixture/basic"))!.value).toBe("v2");
    expect((await listVersions("fixture/basic")).map((v) => v.version)).toEqual([2, 1]);
  });

  it("restore with a matching expected current version succeeds (CAS positive)", async () => {
    await setSecret("fixture/basic", "v1", "other");
    await setSecret("fixture/basic", "v2", "other");
    const restored = await restoreVersion("fixture/basic", 1, { reason: "roll back", expectCurrent: 2 });
    expect(restored.version).toBe(3);
    expect(restored.current).toBe(true);
    expect(restored.change_kind).toBe("restore");
  });
});

describe("reason/label metadata policy (P1-2)", () => {
  it("a benign reason is stored and returned on the read surface", async () => {
    await setSecret("fixture/basic", SENTINEL, "other", undefined, undefined, { reason: "rotated after compromise" });
    const versions = await listVersions("fixture/basic");
    expect(versions[0].reason).toBe("rotated after compromise");
    const restored = await restoreVersion("fixture/basic", 1, { reason: "bad rotation, roll back", expectCurrent: 1 });
    expect(restored.reason).toBe("bad rotation, roll back");
    const serialized = JSON.stringify(await listVersions("fixture/basic"));
    expect(serialized).toContain("bad rotation, roll back");
    expect(serialized).not.toContain(SENTINEL);
    expect(serialized).not.toContain("value_blob");
  });

  it("a credential-shaped reason on set is refused and nothing is stored", async () => {
    await setSecret("fixture/basic", "v1", "other");
    await setSecret("fixture/basic", "v2", "other");
    await expect(setSecret("fixture/basic", "v3", "other", undefined, undefined, { reason: CRED_SHAPED })).rejects.toBeInstanceOf(
      MetadataValidationError,
    );
    // Zero mutation: no new version, served value unchanged, and no row in
    // either table carries the rejected text.
    expect((await getSecret("fixture/basic"))!.value).toBe("v2");
    expect((await listVersions("fixture/basic")).map((v) => v.version)).toEqual([2, 1]);
    const db = getDb();
    const versionRows = db.prepare("SELECT reason FROM secret_versions").all() as Array<{ reason: string | null }>;
    const secretRows = db.prepare("SELECT label FROM secrets").all() as Array<{ label: string | null }>;
    for (const row of [...versionRows, ...secretRows]) {
      expect(JSON.stringify(row)).not.toContain(CRED_SHAPED);
    }
  });

  it("a credential-shaped reason on restore is refused with zero mutation", async () => {
    await setSecret("fixture/basic", "v1", "other");
    await setSecret("fixture/basic", "v2", "other");
    await expect(restoreVersion("fixture/basic", 1, { reason: CRED_SHAPED, expectCurrent: 2 })).rejects.toBeInstanceOf(
      MetadataValidationError,
    );
    expect((await getSecret("fixture/basic"))!.value).toBe("v2");
    expect((await listVersions("fixture/basic")).map((v) => v.version)).toEqual([2, 1]);
  });

  it("a credential-shaped label on set is refused and nothing is stored", async () => {
    await setSecret("fixture/basic", "v1", "other");
    await expect(setSecret("fixture/basic", "v2", "other", CRED_SHAPED)).rejects.toBeInstanceOf(MetadataValidationError);
    expect((await getSecret("fixture/basic"))!.value).toBe("v1");
    expect((await listVersions("fixture/basic")).map((v) => v.version)).toEqual([1]);
  });

  it("an over-length reason is refused and nothing is stored", async () => {
    await setSecret("fixture/basic", "v1", "other");
    await expect(
      setSecret("fixture/basic", "v2", "other", undefined, undefined, { reason: "x".repeat(MAX_METADATA_LENGTH + 1) }),
    ).rejects.toBeInstanceOf(MetadataValidationError);
    expect((await listVersions("fixture/basic")).map((v) => v.version)).toEqual([1]);
  });

  it("read-surface proof: a rejected payload never reaches any stored or served surface", async () => {
    await setSecret("fixture/basic", "v1", "other", undefined, undefined, { reason: "first write" });
    await expect(setSecret("fixture/basic", "v2", "other", undefined, undefined, { reason: CRED_SHAPED })).rejects.toBeInstanceOf(
      MetadataValidationError,
    );
    await setSecret("fixture/basic", "v2", "other", undefined, undefined, { reason: "second write" });
    // The version list is what any secrets:read holder sees; the rejected text
    // (and its fragments) must not appear there, nor in any stored column.
    const serialized = JSON.stringify(await listVersions("fixture/basic"));
    expect(serialized).not.toContain(CRED_SHAPED);
    expect(serialized).not.toContain("sk-synth");
    expect(serialized).not.toContain("etic-value");
    const db = getDb();
    const allReasons = db.prepare("SELECT reason FROM secret_versions").all() as Array<{ reason: string | null }>;
    for (const row of allReasons) {
      expect(JSON.stringify(row)).not.toContain(CRED_SHAPED);
    }
  });
});

describe("secret versioning — value safety", () => {
  it("version rows store the encrypted envelope, never the plaintext", async () => {
    await setSecret("fixture/basic", SENTINEL, "other");
    await setSecret("fixture/basic", "second-value", "other");
    const db = getDb();
    const rows = db.prepare("SELECT value_blob FROM secret_versions WHERE key = ?").all("fixture/basic") as Array<{
      value_blob: string;
    }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.value_blob).not.toContain(SENTINEL);
      expect(row.value_blob).not.toContain("second-value");
      expect(row.value_blob.startsWith("enc:v1:")).toBe(true);
    }
  });

  it("CLI surfaces never print the value on success paths (stdout and stderr captured separately)", async () => {
    await setSecret("fixture/basic", SENTINEL, "other");
    await setSecret("fixture/basic", "second-value", "other");

    const commands: Array<{ args: string[]; stdin?: string }> = [
      { args: ["set", "fixture/argv", SENTINEL] },
      { args: ["set", "fixture/stdin", "--stdin"], stdin: `${SENTINEL}\n` },
      { args: ["versions", "fixture/basic"] },
      { args: ["versions", "fixture/basic", "--json"] },
      { args: ["versions", "fixture/basic", "--version", "1", "--check"] },
      { args: ["restore", "fixture/basic", "--version", "1", "--reason", "safety fixture", "--expect-current", "2"] },
    ];
    for (const { args, stdin } of commands) {
      const { stdout, stderr, exitCode } = await runCli(args, stdin);
      expect(exitCode, args.join(" ")).toBe(0);
      expect(stdout, `stdout of ${args.join(" ")}`).not.toContain(SENTINEL);
      expect(stderr, `stderr of ${args.join(" ")}`).not.toContain(SENTINEL);
    }
  }, 60_000);

  it("CLI failure paths never print the value", async () => {
    await setSecret("fixture/basic", SENTINEL, "other");

    // Restore of a nonexistent version (typed not-found, zero mutation).
    const missing = await runCli(["restore", "fixture/basic", "--version", "99", "--reason", "x", "--expect-current", "1"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).not.toContain(SENTINEL);
    expect(missing.stderr).not.toContain(SENTINEL);
    expect(missing.stderr).toContain("not found");

    // Non-interactive restore without --expect-current is refused outright.
    const noExpect = await runCli(["restore", "fixture/basic", "--version", "1", "--reason", "x"]);
    expect(noExpect.exitCode).toBe(1);
    expect(noExpect.stdout).not.toContain(SENTINEL);
    expect(noExpect.stderr).not.toContain(SENTINEL);
    expect(noExpect.stderr).toContain("--expect-current");

    // Captured `get` refuses to print the value.
    const captured = await runCli(["get", "fixture/basic"]);
    expect(captured.exitCode).toBe(1);
    expect(captured.stdout).not.toContain(SENTINEL);
    expect(captured.stderr).not.toContain(SENTINEL);
    expect(captured.stderr).toContain("Refusing");

    // Ambiguous set (argv + stdin) is refused before any write.
    const ambiguous = await runCli(["set", "fixture/basic", SENTINEL, "--stdin"], SENTINEL);
    expect(ambiguous.exitCode).toBe(1);
    expect(ambiguous.stdout).not.toContain(SENTINEL);
    expect(ambiguous.stderr).not.toContain(SENTINEL);
  }, 60_000);

  it("restore as a rotation does not rewind: a restore after a restore appends", async () => {
    await setSecret("fixture/basic", "v1", "other");
    await setSecret("fixture/basic", "v2", "other");
    await restoreVersion("fixture/basic", 1, { reason: "first rollback", expectCurrent: 2 });
    await restoreVersion("fixture/basic", 2, { reason: "second rollback", expectCurrent: 3 });
    const versions = await listVersions("fixture/basic");
    expect(versions.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect(versions[0]).toMatchObject({ source_version: 2, current: true });
    expect((await getSecret("fixture/basic"))!.value).toBe("v2");
  });
});
