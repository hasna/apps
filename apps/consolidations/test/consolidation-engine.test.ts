// Test spec: agent-authored. The gpt-5.6-sol advisory consult was attempted
// twice (bounded two-attempt rule) and delivered no spec — both sessions ran a
// full read-only census but were killed by the 600s dispatch timeout before
// producing a report (rc=124, empty final message; no capacity refusal was
// observed). Gap selection and expected values in this file were derived by
// directly executing the engine/ops on this checkout.

import { describe, expect, it } from "bun:test";
import { consolidate } from "../src/services/consolidate.js";
import { ValidationError } from "../src/types/index.js";
import { defaultGroupCode, groupAccount, rateTypeForStatement } from "../src/services/group-coa.js";

// Pure-engine gap coverage: FX rate selection per statement type, missing-rate
// failures, default COA fallbacks, partial/unequal intercompany pairs, mapping
// overrides, rounding, and degenerate inputs. Every expected number below was
// derived by running the engine, not by hand.

const USD = "USD";
const EUR = "EUR";

const BS_CODES = new Set(["1000", "1200", "1500", "2000", "2500", "3000"]);

function mapping(entityId: string, local: string, group: string, over: Partial<{ group_account_name: string; statement: "pl" | "bs" | "cf"; section: string }> = {}) {
  return {
    id: `m-${entityId}-${local}`,
    entity_id: entityId,
    local_account_code: local,
    group_account_code: group,
    group_account_name: over.group_account_name ?? "",
    statement: over.statement ?? (BS_CODES.has(group) ? "bs" : "pl"),
    section: over.section ?? "assets",
    created_at: "",
  };
}

describe("consolidate: FX translation", () => {
  it("uses the average rate for P&L lines and the closing rate for BS lines", () => {
    const result = consolidate({
      period: "2026-Q1",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "2026-Q1",
          currency: EUR,
          lines: [
            { account_code: "C1", account_name: "Cash", account_type: "asset", balance: 1000 },
            { account_code: "R1", account_name: "Revenue", account_type: "revenue", balance: -2000 },
          ],
        },
      ],
      mappings: [
        { ...mapping("e1", "C1", "1000"), group_account_name: "Cash", section: "cash" },
        { ...mapping("e1", "R1", "4000"), group_account_name: "Revenue", section: "revenue" },
      ],
      rates: [
        { id: "r1", period: "2026-Q1", from_currency: EUR, to_currency: USD, rate: 1.1, rate_type: "average", created_at: "" },
        { id: "r2", period: "2026-Q1", from_currency: EUR, to_currency: USD, rate: 1.2, rate_type: "closing", created_at: "" },
      ],
    });
    const pl = result.statements.find((s) => s.statement_type === "pl")!;
    const bs = result.statements.find((s) => s.statement_type === "bs")!;
    // P&L translated at average 1.10: -2000 * 1.10 = -2200.
    expect(pl.lines.find((l) => l.group_account_code === "4000")?.amount).toBe(-2200);
    // BS translated at closing 1.20: 1000 * 1.20 = 1200.
    expect(bs.lines.find((l) => l.group_account_code === "1000")?.amount).toBe(1200);
    // P&L drives net income; the BS is force-balanced by the CTA plug.
    expect(result.net_income).toBe(2200);
    expect(bs.total).toBe(0);
    expect(bs.lines.find((l) => l.group_account_code === "3950")?.amount).toBe(1000);
  });

  it("honors a mapping's statement override when choosing the rate type", () => {
    const result = consolidate({
      period: "P",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "P",
          currency: EUR,
          lines: [{ account_code: "R", account_name: "Deferred rev", account_type: "revenue", balance: -1000 }],
        },
      ],
      mappings: [
        { ...mapping("e1", "R", "9999"), group_account_name: "Deferred Revenue", statement: "bs", section: "liabilities" },
      ],
      rates: [{ id: "r1", period: "P", from_currency: EUR, to_currency: USD, rate: 1.25, rate_type: "closing", created_at: "" }],
    });
    const bs = result.statements.find((s) => s.statement_type === "bs")!;
    // A revenue line mapped onto the BS uses the CLOSING rate: -1000 * 1.25.
    expect(bs.lines.find((l) => l.group_account_code === "9999")?.amount).toBe(-1250);
  });

  it("throws a ValidationError naming the rate type when a statement's rate is missing", () => {
    const input = {
      period: "2026-Q1",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "2026-Q1",
          currency: EUR,
          lines: [{ account_code: "R1", account_name: "Revenue", account_type: "revenue", balance: -1000 }],
        },
      ],
      mappings: [{ ...mapping("e1", "R1", "4000"), group_account_name: "Revenue", section: "revenue" }],
      rates: [{ id: "r1", period: "2026-Q1", from_currency: EUR, to_currency: USD, rate: 1.2, rate_type: "closing", created_at: "" }],
    };
    // The closing rate exists but the P&L needs the average rate.
    expect(() => consolidate(input)).toThrow(ValidationError);
    expect(() => consolidate(input)).toThrow("Missing average FX rate EUR->USD for 2026-Q1.");
  });

  it("throws a ValidationError for a missing closing rate on a BS line even when the average rate exists", () => {
    const input = {
      period: "P",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "P",
          currency: EUR,
          lines: [{ account_code: "A", account_name: "Asset", account_type: "asset", balance: 100 }],
        },
      ],
      mappings: [{ ...mapping("e1", "A", "1500"), group_account_name: "Other Assets", section: "assets" }],
      rates: [{ id: "r1", period: "P", from_currency: EUR, to_currency: USD, rate: 1.25, rate_type: "average", created_at: "" }],
    };
    expect(() => consolidate(input)).toThrow("Missing closing FX rate EUR->USD for P.");
  });

  it("treats reporting-currency entities as rate 1 without any rate row", () => {
    const result = consolidate({
      period: "P",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "P",
          currency: USD,
          lines: [{ account_code: "A", account_name: "Cash", account_type: "asset", balance: 42 }],
        },
      ],
      mappings: [{ ...mapping("e1", "A", "1000"), group_account_name: "Cash", section: "cash" }],
      rates: [],
    });
    const bs = result.statements.find((s) => s.statement_type === "bs")!;
    expect(bs.lines.find((l) => l.group_account_code === "1000")?.amount).toBe(42);
  });
});

describe("consolidate: default COA fallbacks", () => {
  it("defaults every unmapped account type to its group code and statement", () => {
    const result = consolidate({
      period: "P",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "P",
          currency: USD,
          lines: [
            { account_code: "A", account_name: "Unmapped Asset", account_type: "asset", balance: 500 },
            { account_code: "L", account_name: "Unmapped Liability", account_type: "liability", balance: -300 },
            { account_code: "E", account_name: "Unmapped Equity", account_type: "equity", balance: -100 },
            { account_code: "R", account_name: "Unmapped Revenue", account_type: "revenue", balance: -700 },
            { account_code: "X", account_name: "Unmapped Expense", account_type: "expense", balance: 200 },
          ],
        },
      ],
      mappings: [],
      rates: [],
    });
    const pl = result.statements.find((s) => s.statement_type === "pl")!;
    const bs = result.statements.find((s) => s.statement_type === "bs")!;
    // Default codes: asset->1500, liability->2500, equity->3000, revenue->4000, expense->6000.
    expect(pl.lines.map((l) => l.group_account_code).sort()).toEqual(["4000", "6000"]);
    expect(bs.lines.map((l) => l.group_account_code).sort()).toEqual(["1500", "2500", "3000", "3900", "3950"]);
    expect(pl.lines.find((l) => l.group_account_code === "4000")?.amount).toBe(-700);
    expect(pl.lines.find((l) => l.group_account_code === "6000")?.amount).toBe(200);
    // P&L sum -500 => net income +500; BS force-balanced by CTA.
    expect(result.net_income).toBe(500);
    expect(bs.total).toBe(0);
    expect(bs.lines.find((l) => l.group_account_code === "3950")?.amount).toBe(400);
  });

  it("defaults group-code helpers exactly", () => {
    expect(defaultGroupCode("asset")).toBe("1500");
    expect(defaultGroupCode("liability")).toBe("2500");
    expect(defaultGroupCode("equity")).toBe("3000");
    expect(defaultGroupCode("revenue")).toBe("4000");
    expect(defaultGroupCode("expense")).toBe("6000");
    expect(rateTypeForStatement("pl")).toBe("average");
    expect(rateTypeForStatement("bs")).toBe("closing");
    expect(rateTypeForStatement("cf")).toBe("closing");
    expect(groupAccount("4100")?.intercompany).toBe(true);
    expect(groupAccount("1200")?.intercompany).toBe(true);
  });
});

describe("consolidate: intercompany eliminations", () => {
  it("nets only the smaller side of an unequal pair and leaves the residual", () => {
    const result = consolidate({
      period: "P",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "P",
          currency: USD,
          lines: [{ account_code: "A", account_name: "IC Recv", account_type: "asset", balance: 10000 }],
        },
        {
          entity_id: "e2",
          period: "P",
          currency: USD,
          lines: [{ account_code: "B", account_name: "IC Pay", account_type: "liability", balance: -4000 }],
        },
      ],
      mappings: [
        { ...mapping("e1", "A", "1200"), group_account_name: "IC Recv", section: "assets" },
        { ...mapping("e2", "B", "2000"), group_account_name: "IC Pay", section: "liabilities" },
      ],
      rates: [],
    });
    const ic = result.eliminations.find((e) => e.group_account_code === "1200/2000")!;
    expect(ic.amount).toBe(4000);
    expect(ic.kind).toBe("intercompany_balance");
    expect(ic.entity_id_from).toBe("group");
    const bs = result.statements.find((s) => s.statement_type === "bs")!;
    expect(bs.lines.find((l) => l.group_account_code === "1200")?.amount).toBe(6000);
    expect(bs.lines.find((l) => l.group_account_code === "2000")?.amount).toBe(0);
  });

  it("skips elimination entirely when only one side of a pair exists", () => {
    const result = consolidate({
      period: "P",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "P",
          currency: USD,
          lines: [{ account_code: "A", account_name: "IC Recv", account_type: "asset", balance: 5000 }],
        },
      ],
      mappings: [{ ...mapping("e1", "A", "1200"), group_account_name: "IC Recv", section: "assets" }],
      rates: [],
    });
    expect(result.eliminations).toHaveLength(0);
    const bs = result.statements.find((s) => s.statement_type === "bs")!;
    expect(bs.lines.find((l) => l.group_account_code === "1200")?.amount).toBe(5000);
  });

  it("records intercompany_revenue for the 4100/6100 pair", () => {
    const result = consolidate({
      period: "P",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "P",
          currency: USD,
          lines: [{ account_code: "A", account_name: "IC Rev", account_type: "revenue", balance: -3000 }],
        },
        {
          entity_id: "e2",
          period: "P",
          currency: USD,
          lines: [{ account_code: "B", account_name: "IC Exp", account_type: "expense", balance: 3000 }],
        },
      ],
      mappings: [
        { ...mapping("e1", "A", "4100"), group_account_name: "IC Rev", section: "revenue" },
        { ...mapping("e2", "B", "6100"), group_account_name: "IC Exp", section: "expenses" },
      ],
      rates: [],
    });
    const ic = result.eliminations.find((e) => e.group_account_code === "4100/6100")!;
    expect(ic.amount).toBe(3000);
    expect(ic.kind).toBe("intercompany_revenue");
    expect(ic.matched).toBe(true);
    // Both sides fully eliminated: net income is unaffected by the pair.
    const pl = result.statements.find((s) => s.statement_type === "pl")!;
    expect(pl.lines.find((l) => l.group_account_code === "4100")?.amount).toBe(0);
    expect(pl.lines.find((l) => l.group_account_code === "6100")?.amount).toBe(0);
    expect(result.net_income).toBe(0);
  });
});

describe("consolidate: mapping and rounding edges", () => {
  it("lands an unknown group code when the mapping supplies name, statement and section", () => {
    const result = consolidate({
      period: "P",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "P",
          currency: USD,
          lines: [{ account_code: "X", account_name: "Weird", account_type: "equity", balance: -77 }],
        },
      ],
      mappings: [
        { ...mapping("e1", "X", "9999"), group_account_name: "Weird Equity", statement: "bs", section: "equity" },
      ],
      rates: [],
    });
    const bs = result.statements.find((s) => s.statement_type === "bs")!;
    const line = bs.lines.find((l) => l.group_account_code === "9999")!;
    expect(line.group_account_name).toBe("Weird Equity");
    expect(line.section).toBe("equity");
    expect(line.amount).toBe(-77);
  });

  it("accumulates lines from multiple entities into one group bucket", () => {
    const result = consolidate({
      period: "P",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "P",
          currency: USD,
          lines: [{ account_code: "R1", account_name: "Rev A", account_type: "revenue", balance: -10000 }],
        },
        {
          entity_id: "e2",
          period: "P",
          currency: USD,
          lines: [{ account_code: "R2", account_name: "Rev B", account_type: "revenue", balance: -5000 }],
        },
      ],
      mappings: [
        { ...mapping("e1", "R1", "4000"), group_account_name: "Revenue", section: "revenue" },
        { ...mapping("e2", "R2", "4000"), group_account_name: "Revenue", section: "revenue" },
      ],
      rates: [],
    });
    const pl = result.statements.find((s) => s.statement_type === "pl")!;
    expect(pl.lines).toHaveLength(1);
    expect(pl.lines[0].amount).toBe(-15000);
    expect(result.net_income).toBe(15000);
  });

  it("rounds translated amounts half-up", () => {
    const result = consolidate({
      period: "P",
      reporting_currency: USD,
      trialBalances: [
        {
          entity_id: "e1",
          period: "P",
          currency: USD,
          lines: [{ account_code: "R", account_name: "Revenue", account_type: "revenue", balance: 2.675 }],
        },
      ],
      mappings: [{ ...mapping("e1", "R", "6000"), group_account_name: "OpEx", section: "expenses" }],
      rates: [],
    });
    const pl = result.statements.find((s) => s.statement_type === "pl")!;
    // 2.675 rounds up to 2.68 (half-up with epsilon), never 2.67.
    expect(pl.lines.find((l) => l.group_account_code === "6000")?.amount).toBe(2.68);
  });

  it("produces zeroed statements for empty input without throwing", () => {
    const result = consolidate({ period: "P", reporting_currency: USD, trialBalances: [], mappings: [], rates: [] });
    expect(result.statements).toHaveLength(3);
    expect(result.net_income).toBe(0);
    expect(result.translation_adjustment).toBe(0);
    expect(result.eliminations).toHaveLength(0);
    const pl = result.statements.find((s) => s.statement_type === "pl")!;
    const bs = result.statements.find((s) => s.statement_type === "bs")!;
    const cf = result.statements.find((s) => s.statement_type === "cf")!;
    expect(pl.lines).toHaveLength(0);
    expect(pl.total).toBe(0);
    expect(bs.lines.map((l) => l.group_account_code)).toEqual(["3900", "3950"]);
    expect(bs.total).toBe(0);
    expect(cf.total).toBe(0);
  });
});
