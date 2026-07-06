import type { TrialBalance } from "../adapters/accounting.js";
import type { CoaMapping, EliminationKind, FxRate, StatementLine, StatementType } from "../types/index.js";
import { ValidationError } from "../types/index.js";
import {
  INTERCOMPANY_PAIRS,
  defaultGroupCode,
  groupAccount,
  rateTypeForStatement,
} from "./group-coa.js";

// Pure consolidation engine: normalize COA -> translate FX -> net intercompany
// eliminations -> produce consolidated P&L / Balance Sheet / Cash Flow.

export interface ConsolidateInput {
  period: string;
  reporting_currency: string;
  trialBalances: TrialBalance[];
  mappings: CoaMapping[];
  rates: FxRate[];
}

export interface ComputedStatement {
  statement_type: StatementType;
  currency: string;
  lines: StatementLine[];
  total: number;
}

export interface ComputedElimination {
  period: string;
  entity_id_from: string;
  entity_id_to: string;
  group_account_code: string;
  amount: number;
  currency: string;
  kind: EliminationKind;
  description: string;
  matched: boolean;
}

export interface ConsolidateResult {
  statements: ComputedStatement[];
  eliminations: ComputedElimination[];
  net_income: number;
  translation_adjustment: number;
}

interface Bucket {
  code: string;
  name: string;
  section: string;
  statement: StatementType;
  amount: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const sign = (n: number): number => (n < 0 ? -1 : 1);

function findRate(input: ConsolidateInput, from: string, statement: StatementType): number {
  if (from === input.reporting_currency) return 1;
  const rateType = rateTypeForStatement(statement);
  const rate = input.rates.find(
    (r) => r.period === input.period && r.from_currency === from && r.to_currency === input.reporting_currency && r.rate_type === rateType,
  );
  if (!rate) {
    throw new ValidationError(
      `Missing ${rateType} FX rate ${from}->${input.reporting_currency} for ${input.period}.`,
    );
  }
  return rate.rate;
}

export function consolidate(input: ConsolidateInput): ConsolidateResult {
  const buckets = new Map<string, Bucket>();

  for (const tb of input.trialBalances) {
    for (const line of tb.lines) {
      const mapping = input.mappings.find(
        (m) => m.entity_id === tb.entity_id && m.local_account_code === line.account_code,
      );
      const code = mapping?.group_account_code ?? defaultGroupCode(line.account_type);
      const ga = groupAccount(code);
      const statement: StatementType = mapping?.statement ?? ga?.statement ?? (line.account_type === "revenue" || line.account_type === "expense" ? "pl" : "bs");
      const name = ga?.name ?? mapping?.group_account_name ?? code;
      const section = ga?.section ?? mapping?.section ?? line.account_type;
      const rate = findRate(input, tb.currency, statement);
      const translated = round2(line.balance * rate);

      const existing = buckets.get(code);
      if (existing) {
        existing.amount = round2(existing.amount + translated);
      } else {
        buckets.set(code, { code, name, section, statement, amount: translated });
      }
    }
  }

  const eliminations: ComputedElimination[] = [];
  for (const [a, b] of INTERCOMPANY_PAIRS) {
    const bucketA = buckets.get(a);
    const bucketB = buckets.get(b);
    if (!bucketA || !bucketB) continue;
    const matched = round2(Math.min(Math.abs(bucketA.amount), Math.abs(bucketB.amount)));
    if (matched <= 0) continue;
    bucketA.amount = round2(bucketA.amount - sign(bucketA.amount) * matched);
    bucketB.amount = round2(bucketB.amount - sign(bucketB.amount) * matched);
    const kind: EliminationKind = a === "4100" ? "intercompany_revenue" : "intercompany_balance";
    eliminations.push({
      period: input.period,
      entity_id_from: "group",
      entity_id_to: "group",
      group_account_code: `${a}/${b}`,
      amount: matched,
      currency: input.reporting_currency,
      kind,
      description: `Netted intercompany ${a} against ${b}`,
      matched: true,
    });
  }

  const all = [...buckets.values()];
  const plBuckets = all.filter((b) => b.statement === "pl").sort((x, y) => x.code.localeCompare(y.code));
  const bsBuckets = all.filter((b) => b.statement === "bs").sort((x, y) => x.code.localeCompare(y.code));

  const plSum = round2(plBuckets.reduce((sum, b) => sum + b.amount, 0));
  const netIncome = round2(-plSum);

  const plLines: StatementLine[] = plBuckets.map((b) => ({
    group_account_code: b.code,
    group_account_name: b.name,
    section: b.section,
    amount: b.amount,
  }));

  const bsLines: StatementLine[] = bsBuckets.map((b) => ({
    group_account_code: b.code,
    group_account_name: b.name,
    section: b.section,
    amount: b.amount,
  }));
  // Current-period net income flows to equity (credit => negative).
  bsLines.push({ group_account_code: "3900", group_account_name: "Net Income (current)", section: "equity", amount: round2(-netIncome) });
  const bsBeforeCta = round2(bsLines.reduce((sum, l) => sum + l.amount, 0));
  const cta = round2(-bsBeforeCta);
  bsLines.push({ group_account_code: "3950", group_account_name: "Cumulative Translation Adjustment", section: "equity", amount: cta });

  const endingCash = round2(
    bsBuckets.filter((b) => b.section === "cash").reduce((sum, b) => sum + b.amount, 0),
  );
  const cfLines: StatementLine[] = [
    { group_account_code: "CF-OP", group_account_name: "Net income (v0 simplified)", section: "operating", amount: netIncome },
    { group_account_code: "CF-CASH", group_account_name: "Ending cash & equivalents", section: "cash", amount: endingCash },
  ];

  const statements: ComputedStatement[] = [
    { statement_type: "pl", currency: input.reporting_currency, lines: plLines, total: netIncome },
    { statement_type: "bs", currency: input.reporting_currency, lines: bsLines, total: round2(bsBeforeCta + cta) },
    { statement_type: "cf", currency: input.reporting_currency, lines: cfLines, total: endingCash },
  ];

  return { statements, eliminations, net_income: netIncome, translation_adjustment: cta };
}
