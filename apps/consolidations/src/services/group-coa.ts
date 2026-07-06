import type { AccountType, RateType, StatementType } from "../types/index.js";

// The group chart-of-accounts: the normalized target every entity's local COA
// maps onto. Intercompany accounts are paired so matched balances net to zero at
// group during elimination.

export interface GroupAccount {
  code: string;
  name: string;
  statement: StatementType;
  section: string;
  intercompany?: boolean;
}

export const GROUP_COA: GroupAccount[] = [
  { code: "1000", name: "Cash & Equivalents", statement: "bs", section: "cash" },
  { code: "1200", name: "Intercompany Receivable", statement: "bs", section: "assets", intercompany: true },
  { code: "1500", name: "Other Assets", statement: "bs", section: "assets" },
  { code: "2000", name: "Intercompany Payable", statement: "bs", section: "liabilities", intercompany: true },
  { code: "2500", name: "Other Liabilities", statement: "bs", section: "liabilities" },
  { code: "3000", name: "Equity", statement: "bs", section: "equity" },
  { code: "4000", name: "Revenue", statement: "pl", section: "revenue" },
  { code: "4100", name: "Intercompany Revenue", statement: "pl", section: "revenue", intercompany: true },
  { code: "6000", name: "Operating Expenses", statement: "pl", section: "expenses" },
  { code: "6100", name: "Intercompany Expenses", statement: "pl", section: "expenses", intercompany: true },
];

const BY_CODE = new Map(GROUP_COA.map((account) => [account.code, account]));

/** Intercompany elimination pairs: [receivable/revenue side, payable/expense side]. */
export const INTERCOMPANY_PAIRS: Array<[string, string]> = [
  ["1200", "2000"],
  ["4100", "6100"],
];

export function groupAccount(code: string): GroupAccount | undefined {
  return BY_CODE.get(code);
}

/** Default group account code when no explicit COA mapping exists for a line. */
export function defaultGroupCode(accountType: AccountType): string {
  switch (accountType) {
    case "asset":
      return "1500";
    case "liability":
      return "2500";
    case "equity":
      return "3000";
    case "revenue":
      return "4000";
    case "expense":
      return "6000";
  }
}

/** FX rate type used to translate a statement's balances (closing for BS, average for P&L). */
export function rateTypeForStatement(statement: StatementType): RateType {
  return statement === "pl" ? "average" : "closing";
}
