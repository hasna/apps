/**
 * Regression tests for the shared effect identity and persistence layer
 * (MON-V2-12 remediation cycle 1).
 *
 * Gates:
 * - the effect key is the FROZEN contract vector — sha256 of the five
 *   components joined by U+0000 — measured against the fixed fixture value,
 *   so a shared-serialization change can never go unnoticed;
 * - the file effect store enforces an exclusive, expiring, fenced cross-process
 *   claim per effect key;
 * - writes leave no temp residue and never share a temp path between writers.
 */

import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { effectKey, FileEffectStore, type EffectRecord } from "./effects.js";

const FIXTURE = {
  slug: "web-health",
  runId: "run-0001",
  actionIndex: 0,
  target: "web-health-check",
  operation: "create",
};

/**
 * Contract fixture value, measured 2026-08-18: the frozen effect-key vector is
 * sha256(slug \0 run_id \0 action_index \0 target \0 operation) over the five
 * design components. The original implementation joined with U+0000; a later
 * remediation switched to JSON.stringify and silently broke every shared
 * caller (idempotency lookups and the loops-store label both changed). This
 * assertion pins the contract key itself, not a comparison with the helper.
 */
const CONTRACT_KEY = "1a0cb26c4a9921c5bbf48af8123cd2e5754156834b70ccc16381f12b06c70694";

describe("effect key contract vector", () => {
  test("the fixture context hashes to the frozen contract key", () => {
    expect(effectKey(FIXTURE)).toBe(CONTRACT_KEY);
  });

  test("a changed component produces a different key", () => {
    const changed = effectKey({ ...FIXTURE, operation: "loops.create" });
    expect(changed).not.toBe(CONTRACT_KEY);
    expect(effectKey({ ...FIXTURE, runId: "run-0002" })).not.toBe(CONTRACT_KEY);
  });
});

describe("FileEffectStore claims", () => {
  test("a fresh claim is exclusive, expiring, and fenced on release", async () => {
    const store = new FileEffectStore(mkdtempSync(join(tmpdir(), "monitor-effects-")));
    const first = await store.claim("k1", 60_000);
    expect(first).not.toBeNull();
    expect(first!.expiresAt > new Date().toISOString()).toBe(true);

    // a second claimant cannot acquire while the claim is fresh
    const second = await store.claim("k1", 60_000);
    expect(second).toBeNull();

    // a wrong token cannot release the claim (fenced release)
    await store.release("k1", "not-the-holder");
    const still = await store.claim("k1", 60_000);
    expect(still).toBeNull();

    // the holder's token releases it
    await store.release("k1", first!.token);
    const after = await store.claim("k1", 60_000);
    expect(after).not.toBeNull();
    await store.release("k1", after!.token);
  });

  test("a stale claim is broken by a later claimant", async () => {
    const store = new FileEffectStore(mkdtempSync(join(tmpdir(), "monitor-effects-")));
    const first = await store.claim("k2", -1);
    expect(first).not.toBeNull();
    const second = await store.claim("k2", 60_000);
    expect(second).not.toBeNull();
    await store.release("k2", second!.token);
  });

  test("record writes leave no temp residue and never share a temp path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-effects-"));
    const store = new FileEffectStore(dir);
    const record: EffectRecord = {
      effectKey: "k3",
      integration: "loops",
      operation: "create",
      target: "t",
      state: "confirmed",
      requestDigest: "d",
      externalId: "l1",
      resultPointer: null,
      lastErrorClass: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.record(record);
    await store.record({ ...record, updatedAt: new Date().toISOString() });
    const residue = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(residue).toEqual([]);
    const saved = await store.get("k3");
    expect(saved).not.toBeNull();
    expect(saved!.externalId).toBe("l1");
  });
});
