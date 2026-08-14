import { now, uuid } from "../db/database.js";
import { appendAudit } from "../db/audit.js";
import { guard, type RunContext } from "./context.js";
import { requireEntity } from "./entities.js";
import { convertMinor, entityFilter } from "./fx.js";
import { ValidationError, type BalanceSnapshot, type AccountKind } from "../types/index.js";

export interface RecordBalanceInput {
  entity_id: string;
  account_ref: string;
  account_kind: AccountKind;
  currency: string;
  amount_minor: number;
  as_of?: string;
  source?: string;
}

/** Cache a balance snapshot (from an upstream adapter or manual entry). */
export async function recordBalance(rc: RunContext, input: RecordBalanceInput): Promise<BalanceSnapshot> {
  guard(rc, "treasury:write", "write", input.entity_id);
  await requireEntity(rc, input.entity_id);
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new ValidationError("currency must be an ISO-4217 code.");
  if (!Number.isInteger(input.amount_minor)) throw new ValidationError("amount_minor must be an integer (minor units).");
  if (input.account_kind !== "bank" && input.account_kind !== "wallet") throw new ValidationError("account_kind must be 'bank' or 'wallet'.");
  const captured_at = now();
  const row: BalanceSnapshot = {
    id: uuid(),
    entity_id: input.entity_id,
    account_ref: input.account_ref,
    account_kind: input.account_kind,
    currency: input.currency,
    amount_minor: input.amount_minor,
    as_of: input.as_of ?? captured_at,
    source: input.source ?? "manual",
    captured_at,
  };
  await rc.db.run(
    "INSERT INTO balance_snapshots (id, entity_id, account_ref, account_kind, currency, amount_minor, as_of, source, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [row.id, row.entity_id, row.account_ref, row.account_kind, row.currency, row.amount_minor, row.as_of, row.source, row.captured_at],
  );
  await appendAudit(rc.db, { entity_id: row.entity_id, actor_id: rc.auth.actor_id, action: "balance.record", detail: `${row.currency} ${row.amount_minor} @ ${row.account_ref}` });
  return row;
}

export interface ListBalancesInput {
  entity_id?: string;
}

export async function listBalances(rc: RunContext, input: ListBalancesInput): Promise<BalanceSnapshot[]> {
  guard(rc, "treasury:read", "read", input.entity_id);
  if (input.entity_id) {
    return rc.db.all<BalanceSnapshot>("SELECT * FROM balance_snapshots WHERE entity_id = ? ORDER BY captured_at DESC", [input.entity_id]);
  }
  const { clause, params } = entityFilter(rc);
  return rc.db.all<BalanceSnapshot>(`SELECT * FROM balance_snapshots ${clause} ORDER BY captured_at DESC`, params);
}

export interface ConsolidatedInput {
  base?: string;
}

export interface ConsolidatedBalances {
  base_currency: string;
  as_of: string;
  total_in_base_minor: number;
  by_currency: Array<{ currency: string; total_minor: number; in_base_minor: number }>;
}

/** Consolidated balance across visible entities, converted to a single base. */
export async function consolidatedBalances(rc: RunContext, input: ConsolidatedInput): Promise<ConsolidatedBalances> {
  guard(rc, "treasury:read", "read");
  const base = (input.base ?? "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) throw new ValidationError("base must be an ISO-4217 code.");
  const { clause, params } = entityFilter(rc);
  const rows = await rc.db.all<{ currency: string; total_minor: number }>(
    `SELECT currency, SUM(amount_minor) AS total_minor FROM balance_snapshots ${clause} GROUP BY currency`,
    params,
  );
  let total = 0;
  const by_currency = [];
  for (const r of rows) {
    const in_base_minor = await convertMinor(rc.db, r.total_minor, r.currency, base);
    total += in_base_minor;
    by_currency.push({ currency: r.currency, total_minor: r.total_minor, in_base_minor });
  }
  by_currency.sort((a, b) => b.in_base_minor - a.in_base_minor);
  return { base_currency: base, as_of: now(), total_in_base_minor: total, by_currency };
}
