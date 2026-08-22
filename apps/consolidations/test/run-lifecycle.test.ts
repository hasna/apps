// Test spec: agent-authored. The gpt-5.6-sol advisory consult was attempted
// twice (bounded two-attempt rule) and delivered no spec — both sessions ran a
// full read-only census but were killed by the 600s dispatch timeout before
// producing a report (rc=124, empty final message; no capacity refusal was
// observed). Gap selection and expected values in this file were derived by
// directly executing the engine/ops on this checkout.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FIXTURE_ENTITY_RO, FIXTURE_ENTITY_UK, FIXTURE_ENTITY_US } from "../src/adapters/entities.js";
import { openStore } from "../src/db/database.js";
import { executeOp, SYSTEM_PRINCIPAL } from "../src/services/execute.js";
import { seedDemo } from "../src/services/fixtures-seed.js";
import { newId } from "../src/services/ids.js";
import { getOp } from "../src/services/registry.js";
import type { Run, Statement } from "../src/types/index.js";
import { cleanupTempDb, useTempDb } from "./helpers.js";

// Ops-level gap coverage: compute failure modes, recompute idempotency,
// latest-import-wins, input validation edges, audit event presence, and the
// finalize stamp. Every expected number was derived by running the ops.

let dbPath: string;

beforeEach(() => {
  dbPath = useTempDb();
});
afterEach(() => cleanupTempDb(dbPath));

const run = (op: string, input: Record<string, unknown> = {}) => executeOp(getOp(op)!, SYSTEM_PRINCIPAL, input);

async function seeded(): Promise<void> {
  const store = await openStore();
  await seedDemo(store);
  await store.close();
}

async function createUsRoRun(): Promise<Run> {
  return (await run("run.create", {
    period: "2026-Q1",
    reporting_currency: "USD",
    entity_ids: [FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO],
  })) as Run;
}

describe("run lifecycle edges", () => {
  beforeEach(seeded);

  it("rejects a comma-separated entity_ids string that is empty", async () => {
    await expect(run("run.create", { period: "P", reporting_currency: "USD", entity_ids: "" })).rejects.toThrow(
      /String must contain at least 1 character/,
    );
  });

  it("accepts comma-separated entity_ids as a string", async () => {
    const created = (await run("run.create", {
      period: "2026-Q1",
      reporting_currency: "USD",
      entity_ids: `${FIXTURE_ENTITY_US},${FIXTURE_ENTITY_RO}`,
    })) as Run;
    expect(created.entity_ids).toEqual([FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO]);
    expect(created.status).toBe("draft");
  });

  it("fails compute with a clear error when an entity has no GL import", async () => {
    const created = (await run("run.create", {
      period: "2026-Q1",
      reporting_currency: "USD",
      entity_ids: [FIXTURE_ENTITY_US, FIXTURE_ENTITY_UK],
    })) as Run;
    await expect(run("run.compute", { id: created.id })).rejects.toThrow(
      `No GL import for entity ${FIXTURE_ENTITY_UK} in 2026-Q1. Import it first.`,
    );
  });

  it("recomputing replaces prior statements and eliminations instead of duplicating them", async () => {
    const created = await createUsRoRun();
    const first = (await run("run.compute", { id: created.id })) as {
      statements: Statement[];
      eliminations: unknown[];
    };
    const second = (await run("run.compute", { id: created.id })) as {
      statements: Statement[];
      eliminations: unknown[];
    };
    expect(first.statements).toHaveLength(3);
    expect(second.statements).toHaveLength(3);
    expect(second.eliminations).toHaveLength(first.eliminations.length);
    // The persisted statement set is exactly 3 after two computes — no stale rows.
    const listed = (await run("statement.list", { run_id: created.id })) as { statements: Statement[] };
    expect(listed.statements).toHaveLength(3);
    expect(listed.statements.map((s) => s.statement_type).sort()).toEqual(["bs", "cf", "pl"]);
  });

  it("computes from the LATEST GL import for an entity/period, not the first", async () => {
    const created = await createUsRoRun();
    // Insert a second RO import for the same period with a distinctive cash balance.
    // created_at is set explicitly and AFTER the seeded import's, so the store's
    // (created_at, id) ordering deterministically makes this the latest import.
    const store = await openStore();
    await store.insert("gl_imports", {
      id: newId(),
      entity_id: FIXTURE_ENTITY_RO,
      period: "2026-Q1",
      created_at: new Date(Date.now() + 60_000).toISOString(),
      data: {
        entity_id: FIXTURE_ENTITY_RO,
        period: "2026-Q1",
        source: "test:second-import",
        currency: "RON",
        status: "imported",
        lines: [{ account_code: "1000", account_name: "Cont Curent", account_type: "asset", balance: 999999 }],
        imported_at: new Date().toISOString(),
      },
    });
    await store.close();

    const computed = (await run("run.compute", { id: created.id })) as { statements: Statement[] };
    const bs = computed.statements.find((s) => s.statement_type === "bs")!;
    // US cash 100000 USD + RO cash 999999 RON at the closing rate 0.25.
    expect(bs.lines.find((l) => l.group_account_code === "1000")?.amount).toBe(349999.75);
  });

  it("stamps finalized_at and rejects compute on a finalized run", async () => {
    const created = await createUsRoRun();
    await run("run.compute", { id: created.id });
    const finalized = (await run("run.finalize", { id: created.id })) as Run;
    expect(finalized.status).toBe("finalized");
    expect(finalized.finalized_at).toBeTruthy();
    expect(new Date(finalized.finalized_at!).getTime()).not.toBeNaN();
    await expect(run("run.compute", { id: created.id })).rejects.toThrow(/finalized and immutable/);
    // A finalized run cannot be finalized again either.
    await expect(run("run.finalize", { id: created.id })).rejects.toThrow(/must be 'computed'/);
  });
});

describe("reference and GL validation edges", () => {
  beforeEach(seeded);

  it("rejects a COA mapping to an unknown group account without explicit fields", async () => {
    await expect(
      run("coa_mapping.create", { entity_id: FIXTURE_ENTITY_US, local_account_code: "X1", group_account_code: "9999" }),
    ).rejects.toThrow(/Unknown group account '9999'; supply group_account_name, statement and section explicitly\./);
  });

  it("accepts an unknown group account when name, statement and section are explicit", async () => {
    const created = (await run("coa_mapping.create", {
      entity_id: FIXTURE_ENTITY_US,
      local_account_code: "X2",
      group_account_code: "9999",
      group_account_name: "Custom Account",
      statement: "bs",
      section: "assets",
    })) as { group_account_code: string; group_account_name: string; statement: string; section: string };
    expect(created.group_account_code).toBe("9999");
    expect(created.group_account_name).toBe("Custom Account");
    expect(created.statement).toBe("bs");
    expect(created.section).toBe("assets");
  });

  it("fails gl_import.create with NOT_FOUND when the entity has no trial balance", async () => {
    await expect(
      run("gl_import.create", { entity_id: FIXTURE_ENTITY_UK, period: "2026-Q1" }),
    ).rejects.toThrow(/No trial balance for entity c4d8e1f2-7a3b-4d5c-8e19-2b6f9c1d4e55 in 2026-Q1\./);
  });

  it("rejects a non-positive FX rate", async () => {
    await expect(
      run("fx_rate.create", { period: "2026-Q1", from_currency: "EUR", to_currency: "USD", rate: 0, rate_type: "average" }),
    ).rejects.toThrow(/rate: Number must be greater than 0/);
  });

  it("rejects an invalid rate_type enum", async () => {
    await expect(
      run("fx_rate.create", { period: "2026-Q1", from_currency: "EUR", to_currency: "USD", rate: 1.1, rate_type: "spot" }),
    ).rejects.toThrow(/rate_type: Invalid enum value/);
  });

  it("rejects an invalid elimination kind", async () => {
    await expect(
      run("elimination.create", {
        period: "2026-Q1",
        entity_id_from: FIXTURE_ENTITY_US,
        entity_id_to: FIXTURE_ENTITY_RO,
        group_account_code: "3000",
        amount: 100,
        currency: "USD",
        kind: "bogus",
      }),
    ).rejects.toThrow(/kind: Invalid enum value/);
  });
});

describe("audit trail through ops", () => {
  beforeEach(seeded);

  it("records lifecycle events in a verifiable chain for every mutating op exercised", async () => {
    await run("fx_rate.create", { period: "2026-Q1", from_currency: "EUR", to_currency: "USD", rate: 1.1, rate_type: "average" });
    await run("gl_import.create", { entity_id: FIXTURE_ENTITY_US, period: "2026-Q1" });
    const created = await createUsRoRun();
    await run("run.compute", { id: created.id });
    await run("run.finalize", { id: created.id });
    await run("elimination.create", {
      period: "2026-Q1",
      entity_id_from: FIXTURE_ENTITY_US,
      entity_id_to: FIXTURE_ENTITY_RO,
      group_account_code: "3000",
      amount: 100,
      currency: "USD",
      kind: "investment",
    });

    const audit = (await run("audit.list")) as { events: Array<{ event: string }>; verification: { ok: boolean } };
    const events = audit.events.map((e) => e.event);
    for (const expected of ["fx_rate.created", "gl_import.created", "run.created", "run.computed", "run.finalized", "elimination.created"]) {
      expect(events).toContain(expected);
    }
    expect(audit.verification.ok).toBe(true);
  });
});
