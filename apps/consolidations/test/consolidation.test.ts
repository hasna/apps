import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FIXTURE_ENTITY_RO, FIXTURE_ENTITY_US } from "../src/adapters/entities.js";
import { openStore } from "../src/db/database.js";
import { consolidate } from "../src/services/consolidate.js";
import { executeOp, SYSTEM_PRINCIPAL } from "../src/services/execute.js";
import { seedDemo } from "../src/services/fixtures-seed.js";
import { getOp } from "../src/services/registry.js";
import type { Run, Statement } from "../src/types/index.js";
import { cleanupTempDb, useTempDb } from "./helpers.js";

let dbPath: string;

beforeEach(() => {
  dbPath = useTempDb();
});
afterEach(() => cleanupTempDb(dbPath));

const run = (op: string, input: Record<string, unknown> = {}) => executeOp(getOp(op)!, SYSTEM_PRINCIPAL, input);

describe("consolidation engine (pure)", () => {
  it("nets intercompany balances and balances the BS with a CTA plug", () => {
    const result = consolidate({
      period: "2026-Q1",
      reporting_currency: "USD",
      trialBalances: [
        {
          entity_id: "us",
          period: "2026-Q1",
          currency: "USD",
          lines: [
            { account_code: "1000", account_name: "Cash", account_type: "asset", balance: 100000 },
            { account_code: "1200", account_name: "Due from RO", account_type: "asset", balance: 20000 },
            { account_code: "3000", account_name: "Equity", account_type: "equity", balance: -120000 },
          ],
        },
        {
          entity_id: "ro",
          period: "2026-Q1",
          currency: "USD",
          lines: [
            { account_code: "2200", account_name: "Due to US", account_type: "liability", balance: -20000 },
            { account_code: "3000", account_name: "Equity", account_type: "equity", balance: 20000 },
          ],
        },
      ],
      mappings: [
        { id: "m1", entity_id: "us", local_account_code: "1200", group_account_code: "1200", group_account_name: "IC Recv", statement: "bs", section: "assets", created_at: "" },
        { id: "m2", entity_id: "ro", local_account_code: "2200", group_account_code: "2000", group_account_name: "IC Pay", statement: "bs", section: "liabilities", created_at: "" },
        { id: "m3", entity_id: "us", local_account_code: "1000", group_account_code: "1000", group_account_name: "Cash", statement: "bs", section: "cash", created_at: "" },
      ],
      rates: [],
    });
    const ic = result.eliminations.find((e) => e.group_account_code === "1200/2000");
    expect(ic?.amount).toBe(20000);
    const bs = result.statements.find((s) => s.statement_type === "bs")!;
    expect(bs.total).toBe(0);
    // IC receivable/payable eliminated to zero.
    expect(bs.lines.find((l) => l.group_account_code === "1200")?.amount).toBe(0);
    expect(bs.lines.find((l) => l.group_account_code === "2000")?.amount).toBe(0);
  });
});

describe("consolidation run (end-to-end over fixtures)", () => {
  beforeEach(async () => {
    const store = await openStore();
    await seedDemo(store);
    await store.close();
  });

  it("computes the golden US+RO consolidation", async () => {
    const created = (await run("run.create", {
      period: "2026-Q1",
      reporting_currency: "USD",
      entity_ids: [FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO],
    })) as Run;
    expect(created.status).toBe("draft");

    const computed = (await run("run.compute", { id: created.id })) as {
      net_income: number;
      translation_adjustment: number;
      statements: Statement[];
    };
    expect(computed.net_income).toBe(60000);
    expect(computed.translation_adjustment).toBe(-3750);

    const pl = computed.statements.find((s) => s.statement_type === "pl")!;
    const bs = computed.statements.find((s) => s.statement_type === "bs")!;
    const cf = computed.statements.find((s) => s.statement_type === "cf")!;
    expect(pl.total).toBe(60000);
    expect(bs.total).toBe(0);
    expect(cf.lines.find((l) => l.group_account_code === "CF-CASH")?.amount).toBe(162500);

    // Statements are persisted and listable.
    const list = (await run("statement.list", { run_id: created.id })) as { statements: Statement[] };
    expect(list.statements).toHaveLength(3);
  });

  it("blocks finalize before compute and freezes a finalized run", async () => {
    const created = (await run("run.create", {
      period: "2026-Q1",
      reporting_currency: "USD",
      entity_ids: [FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO],
    })) as Run;
    await expect(run("run.finalize", { id: created.id })).rejects.toThrow(/computed/);
    await run("run.compute", { id: created.id });
    const finalized = (await run("run.finalize", { id: created.id })) as Run;
    expect(finalized.status).toBe("finalized");
    await expect(run("run.compute", { id: created.id })).rejects.toThrow(/immutable/);
  });
});
