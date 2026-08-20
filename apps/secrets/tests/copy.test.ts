import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDb } from "../src/db.js";
import { LocalStore } from "../src/store/index.js";
import {
  copyReason,
  copySecret,
  valueCheck,
  verifyCopy,
  CopySourceEqualsDestinationError,
  CopySourceNotFoundError,
} from "../src/copy.js";

// Unit coverage for the value-safe copy primitive. The value must never appear
// anywhere the caller can render — these assertions exercise the composition
// directly (get -> set in-process) without a spawned CLI, because the CLI
// surface is covered separately in cli-copy.test.ts (which also asserts no value
// bytes reach stdout/stderr).
//
// Fixture value follows the suite's scanner-silent convention: obviously fake,
// no detector shape, compared by length + sha256 wherever possible.

const OLD_KEY = "example/copy-test/test/source_key";
const NEW_KEY = "example/copy-test/test/dest_key";
const VALUE = "fixture-not-a-real-credential-0123456789abcdef";
const VALUE_SHA256 = createHash("sha256").update(VALUE).digest("hex");

const store = new LocalStore();

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `secrets-copy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.OPEN_SECRETS_DB = join(testDir, "vault.db");
  resetDb();
});

afterEach(() => {
  resetDb();
  delete process.env.OPEN_SECRETS_DB;
  rmSync(testDir, { recursive: true, force: true });
});

describe("copyReason — provenance auto-carry", () => {
  it("defaults to naming the source path", () => {
    expect(copyReason(OLD_KEY)).toBe(`migrated from ${OLD_KEY}`);
  });

  it("explicit reason replaces the default, never appends value material", () => {
    expect(copyReason(OLD_KEY, "taxonomy 2026-08-20")).toBe("taxonomy 2026-08-20");
  });
});

describe("valueCheck — get --check class, never the value", () => {
  it("returns length + sha256 only", () => {
    const check = valueCheck({ value: VALUE } as never);
    expect(check.length).toBe(VALUE.length);
    expect(check.hash).toBe(VALUE_SHA256);
    expect(JSON.stringify(check)).not.toContain(VALUE);
  });
});

describe("copySecret", () => {
  it("copies the value in-process and leaves the source key intact", async () => {
    await store.setSecret(OLD_KEY, VALUE, "api_key", "Source label", "2027-01-01T00:00:00.000Z");

    const result = await copySecret(store, OLD_KEY, NEW_KEY);

    expect(result.oldKey).toBe(OLD_KEY);
    expect(result.newKey).toBe(NEW_KEY);
    expect(result.reason).toBe(`migrated from ${OLD_KEY}`);

    // Source intact: value, check, metadata all unchanged.
    const oldEntry = await store.getSecret(OLD_KEY)!;
    expect(oldEntry!.value).toBe(VALUE);
    expect(oldEntry!.type).toBe("api_key");
    expect(oldEntry!.label).toBe("Source label");
    expect(oldEntry!.expires_at).toBe("2027-01-01T00:00:00.000Z");

    // Destination carries the source metadata by default.
    const newEntry = await store.getSecret(NEW_KEY)!;
    expect(newEntry!.value).toBe(VALUE);
    expect(newEntry!.type).toBe("api_key");
    expect(newEntry!.label).toBe("Source label");
    expect(newEntry!.expires_at).toBe("2027-01-01T00:00:00.000Z");

    // Provenance lands in the destination's version record. A brand-new
    // destination records the store's `initial` kind; the migration provenance
    // reason is what distinguishes the copy in the audit trail.
    const versions = await store.listVersions(NEW_KEY);
    expect(versions[0]?.reason).toBe(`migrated from ${OLD_KEY}`);

    // A copy onto an existing destination with a different value records a
    // `migration` version, so copies are distinguishable in the version history.
    await store.setSecret(NEW_KEY, "fixture-not-a-real-credential-overwritten", "api_key");
    await copySecret(store, OLD_KEY, NEW_KEY);
    const afterOverwrite = await store.listVersions(NEW_KEY);
    expect(afterOverwrite[0]?.change_kind).toBe("migration");
    expect(afterOverwrite[0]?.reason).toBe(`migrated from ${OLD_KEY}`);
  });

  it("honours explicit type/label/expiry/reason overrides", async () => {
    await store.setSecret(OLD_KEY, VALUE, "other", "Old label");

    const result = await copySecret(store, OLD_KEY, NEW_KEY, {
      type: "token",
      label: "New label",
      expiresAt: "2028-02-01T00:00:00.000Z",
      reason: "taxonomy pass",
    });

    expect(result.type).toBe("token");
    expect(result.label).toBe("New label");
    expect(result.expiresAt).toBe("2028-02-01T00:00:00.000Z");
    expect(result.reason).toBe("taxonomy pass");

    const newEntry = await store.getSecret(NEW_KEY)!;
    expect(newEntry!.value).toBe(VALUE);
    expect(newEntry!.type).toBe("token");
    expect(newEntry!.label).toBe("New label");
    expect(newEntry!.expires_at).toBe("2028-02-01T00:00:00.000Z");
  });

  it("refuses an identical source and destination", async () => {
    await store.setSecret(OLD_KEY, VALUE);
    expect(async () => copySecret(store, OLD_KEY, OLD_KEY)).toThrow(CopySourceEqualsDestinationError);
  });

  it("reports a missing source without value material", async () => {
    expect(async () => copySecret(store, "example/none/test/missing", NEW_KEY)).toThrow(
      CopySourceNotFoundError,
    );
  });
});

describe("verifyCopy — internal check-equality (length + sha256)", () => {
  it("matches when the destination holds the copied value", async () => {
    await store.setSecret(OLD_KEY, VALUE);
    await copySecret(store, OLD_KEY, NEW_KEY);

    const verified = await verifyCopy(store, OLD_KEY, NEW_KEY);
    expect(verified.match).toBe(true);
    expect(verified.length).toBe(VALUE.length);
  });

  it("reports a mismatch when the destination value differs, with no value material", async () => {
    await store.setSecret(OLD_KEY, VALUE);
    await copySecret(store, OLD_KEY, NEW_KEY);
    // Simulate a silent transport/server-side corruption of the destination.
    await store.setSecret(NEW_KEY, "fixture-not-a-real-credential-CORRUPTED-abcdef");

    const verified = await verifyCopy(store, OLD_KEY, NEW_KEY);
    expect(verified.match).toBe(false);

    // Neither the real value nor the corrupted value may surface in the result.
    const serialized = JSON.stringify(verified);
    expect(serialized).not.toContain(VALUE);
    expect(serialized).not.toContain("CORRUPTED");
  });
});
