// Test spec: agent-authored. The gpt-5.6-sol advisory consult was attempted
// twice (bounded two-attempt rule) and delivered no spec — both sessions ran a
// full read-only census but were killed by the 600s dispatch timeout before
// producing a report (rc=124, empty final message; no capacity refusal was
// observed). Gap selection and expected values in this file were derived by
// directly executing the engine/ops on this checkout.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { DATA_TABLES } from "../src/db/store.js";
import { executeOp, SYSTEM_PRINCIPAL } from "../src/services/execute.js";
import { getOp } from "../src/services/registry.js";
import { cleanupTempDb, useTempDb } from "./helpers.js";

// Storage/audit parity gaps: the push/pull/sync ops must fail CLOSED when no
// cloud DATABASE_URL is configured (never a silent no-op or partial sync), and
// the DATA_TABLES contract that bounds every copy loop must exclude the
// append-only audit_log — audit rows can never be synced by construction.

let dbPath: string;

beforeEach(() => {
  dbPath = useTempDb();
  // The tests in this file must not inherit a cloud URL from the environment.
  delete process.env["HASNA_CONSOLIDATIONS_DATABASE_URL"];
  delete process.env["CONSOLIDATIONS_DATABASE_URL"];
  delete process.env["HASNA_CONSOLIDATIONS_DATABASE_URL_FILE"];
  delete process.env["CONSOLIDATIONS_DATABASE_URL_FILE"];
});
afterEach(() => cleanupTempDb(dbPath));

const run = (op: string, input: Record<string, unknown> = {}) => executeOp(getOp(op)!, SYSTEM_PRINCIPAL, input);

describe("storage ops fail closed without a cloud backend", () => {
  it("push refuses with a clear validation error when no DATABASE_URL is configured", async () => {
    await expect(run("storage.push")).rejects.toThrow("Cannot push: no cloud DATABASE_URL configured.");
  });

  it("pull refuses with a clear validation error when no DATABASE_URL is configured", async () => {
    await expect(run("storage.pull")).rejects.toThrow("Cannot pull: no cloud DATABASE_URL configured.");
  });

  it("sync refuses at the push step when no DATABASE_URL is configured", async () => {
    await expect(run("storage.sync")).rejects.toThrow("Cannot push: no cloud DATABASE_URL configured.");
  });

  it("does not mutate the local store when a sync refuses", async () => {
    // Seed a run so the store has data, then verify the refused sync left it intact.
    const { openStore } = await import("../src/db/database.js");
    const store = await openStore();
    await store.insert("runs", {
      id: "run-1",
      period: "2026-Q1",
      data: { period: "2026-Q1", reporting_currency: "USD", entity_ids: ["e1"], status: "draft" },
    });
    await store.close();

    await expect(run("storage.sync")).rejects.toThrow(/Cannot push/);

    const storeAfter = await openStore();
    const rows = await storeAfter.list("runs");
    await storeAfter.close();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("run-1");
  });
});

describe("DATA_TABLES sync contract", () => {
  it("covers exactly the seven domain tables", () => {
    expect([...DATA_TABLES].sort()).toEqual(
      ["coa_mappings", "eliminations", "entities", "fx_rates", "gl_imports", "runs", "statements"].sort(),
    );
  });

  it("excludes the append-only audit_log from every copy loop", () => {
    // storage-ops copyData iterates DATA_TABLES only; if audit_log is not a
    // member, audit rows can never be pushed/pulled/synced by construction.
    expect(DATA_TABLES).not.toContain("audit_log");
  });
});
