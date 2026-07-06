import { now, uuid, type QueryClient } from "../db/database.js";
import { appendAudit } from "../db/audit.js";
import { guard, type RunContext } from "./context.js";
import { ValidationError, type FxRate, type FxExposureReport, type CurrencyExposure } from "../types/index.js";

export interface RecordRateInput {
  base_currency: string;
  quote_currency: string;
  rate: number;
  as_of?: string;
  source?: string;
}

export async function recordFxRate(rc: RunContext, input: RecordRateInput): Promise<FxRate> {
  guard(rc, "treasury:write", "write");
  if (!/^[A-Z]{3}$/.test(input.base_currency) || !/^[A-Z]{3}$/.test(input.quote_currency)) {
    throw new ValidationError("base_currency and quote_currency must be ISO-4217 codes.");
  }
  if (!(input.rate > 0)) throw new ValidationError("rate must be a positive number.");
  const captured_at = now();
  const row: FxRate = {
    id: uuid(),
    base_currency: input.base_currency,
    quote_currency: input.quote_currency,
    rate: input.rate,
    as_of: input.as_of ?? captured_at,
    source: input.source ?? "manual",
    captured_at,
  };
  await rc.db.run(
    "INSERT INTO fx_rates (id, base_currency, quote_currency, rate, as_of, source, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [row.id, row.base_currency, row.quote_currency, row.rate, row.as_of, row.source, row.captured_at],
  );
  await appendAudit(rc.db, { entity_id: null, actor_id: rc.auth.actor_id, action: "fx.record", detail: `${row.base_currency}/${row.quote_currency}=${row.rate}` });
  return row;
}

export async function listFxRates(rc: RunContext): Promise<FxRate[]> {
  guard(rc, "treasury:read", "read");
  return rc.db.all<FxRate>("SELECT * FROM fx_rates ORDER BY captured_at DESC");
}

/**
 * Convert an integer minor amount from one currency to another using the most
 * recently captured rate for the pair (either direction). Throws if no rate
 * path exists so exposure/runway never silently under-count.
 */
export async function convertMinor(db: QueryClient, amountMinor: number, from: string, to: string): Promise<number> {
  if (from === to) return amountMinor;
  const direct = await db.get<{ rate: number }>(
    "SELECT rate FROM fx_rates WHERE base_currency = ? AND quote_currency = ? ORDER BY captured_at DESC LIMIT 1",
    [to, from],
  );
  if (direct) return Math.round(amountMinor / direct.rate);
  const inverse = await db.get<{ rate: number }>(
    "SELECT rate FROM fx_rates WHERE base_currency = ? AND quote_currency = ? ORDER BY captured_at DESC LIMIT 1",
    [from, to],
  );
  if (inverse) return Math.round(amountMinor * inverse.rate);
  throw new ValidationError(`No FX rate available to convert ${from} -> ${to}. Record a rate first.`);
}

export interface ExposureInput {
  base?: string;
}

/** FX exposure across every balance the principal can see, converted to `base`. */
export async function fxExposure(rc: RunContext, input: ExposureInput): Promise<FxExposureReport> {
  guard(rc, "treasury:read", "read");
  const base = (input.base ?? "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) throw new ValidationError("base must be an ISO-4217 code.");
  const rows = await visibleBalanceSums(rc);
  const exposures: CurrencyExposure[] = [];
  let totalInBase = 0;
  for (const { currency, total_minor } of rows) {
    const in_base_minor = await convertMinor(rc.db, total_minor, currency, base);
    totalInBase += in_base_minor;
    exposures.push({ currency, total_minor, in_base_minor });
  }
  exposures.sort((a, b) => b.in_base_minor - a.in_base_minor);
  return { base_currency: base, as_of: now(), total_in_base_minor: totalInBase, exposures };
}

/** Sum balances by currency, filtered to the principal's visible entities. */
export async function visibleBalanceSums(rc: RunContext): Promise<Array<{ currency: string; total_minor: number }>> {
  const { clause, params } = entityFilter(rc);
  return rc.db.all<{ currency: string; total_minor: number }>(
    `SELECT currency, SUM(amount_minor) AS total_minor FROM balance_snapshots ${clause} GROUP BY currency`,
    params,
  );
}

export function entityFilter(rc: RunContext, column = "entity_id"): { clause: string; params: unknown[] } {
  if (rc.auth.bypass) return { clause: "", params: [] };
  const ids = rc.auth.entity_ids ?? [];
  if (ids.length === 0) return { clause: "WHERE 1=0", params: [] };
  const placeholders = ids.map(() => "?").join(", ");
  return { clause: `WHERE ${column} IN (${placeholders})`, params: [...ids] };
}
