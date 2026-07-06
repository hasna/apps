import { now, uuid } from "../db/database.js";
import { appendAudit } from "../db/audit.js";
import { guard, type RunContext } from "./context.js";
import { requireEntity } from "./entities.js";
import { convertMinor, entityFilter } from "./fx.js";
import { ValidationError, type CostFeed, type RunwayReport } from "../types/index.js";

export interface RecordCostFeedInput {
  entity_id: string;
  currency: string;
  monthly_burn_minor: number;
  as_of?: string;
  source?: string;
}

/** Record a monthly net cash burn for an entity (feeds runway + forecast). */
export async function recordCostFeed(rc: RunContext, input: RecordCostFeedInput): Promise<CostFeed> {
  guard(rc, "treasury:write", "write", input.entity_id);
  await requireEntity(rc, input.entity_id);
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new ValidationError("currency must be an ISO-4217 code.");
  if (!Number.isInteger(input.monthly_burn_minor)) throw new ValidationError("monthly_burn_minor must be an integer (minor units).");
  const captured_at = now();
  const row: CostFeed = {
    id: uuid(),
    entity_id: input.entity_id,
    currency: input.currency,
    monthly_burn_minor: input.monthly_burn_minor,
    as_of: input.as_of ?? captured_at,
    source: input.source ?? "manual",
    captured_at,
  };
  await rc.db.run(
    "INSERT INTO cost_feeds (id, entity_id, currency, monthly_burn_minor, as_of, source, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [row.id, row.entity_id, row.currency, row.monthly_burn_minor, row.as_of, row.source, row.captured_at],
  );
  await appendAudit(rc.db, { entity_id: row.entity_id, actor_id: rc.auth.actor_id, action: "cost.record", detail: `${row.currency} ${row.monthly_burn_minor}/mo` });
  return row;
}

export async function listCostFeeds(rc: RunContext, input: { entity_id?: string }): Promise<CostFeed[]> {
  guard(rc, "treasury:read", "read", input.entity_id);
  if (input.entity_id) {
    return rc.db.all<CostFeed>("SELECT * FROM cost_feeds WHERE entity_id = ? ORDER BY captured_at DESC", [input.entity_id]);
  }
  const { clause, params } = entityFilter(rc);
  return rc.db.all<CostFeed>(`SELECT * FROM cost_feeds ${clause} ORDER BY captured_at DESC`, params);
}

/** Latest cost feed per (entity, currency), optionally scoped to one entity. */
async function latestCostFeeds(rc: RunContext, entity_id?: string): Promise<CostFeed[]> {
  const rows = entity_id
    ? await rc.db.all<CostFeed>("SELECT * FROM cost_feeds WHERE entity_id = ? ORDER BY captured_at DESC", [entity_id])
    : await (async () => {
        const { clause, params } = entityFilter(rc);
        return rc.db.all<CostFeed>(`SELECT * FROM cost_feeds ${clause} ORDER BY captured_at DESC`, params);
      })();
  const seen = new Set<string>();
  const latest: CostFeed[] = [];
  for (const r of rows) {
    const key = `${r.entity_id}:${r.currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(r);
  }
  return latest;
}

async function sumBalancesInBase(rc: RunContext, base: string, entity_id?: string): Promise<number> {
  const rows = entity_id
    ? await rc.db.all<{ currency: string; total_minor: number }>(
        "SELECT currency, SUM(amount_minor) AS total_minor FROM balance_snapshots WHERE entity_id = ? GROUP BY currency",
        [entity_id],
      )
    : await (async () => {
        const { clause, params } = entityFilter(rc);
        return rc.db.all<{ currency: string; total_minor: number }>(
          `SELECT currency, SUM(amount_minor) AS total_minor FROM balance_snapshots ${clause} GROUP BY currency`,
          params,
        );
      })();
  let total = 0;
  for (const r of rows) total += await convertMinor(rc.db, r.total_minor, r.currency, base);
  return total;
}

function runwayMonths(cash: number, burn: number): number | null {
  if (burn <= 0) return null; // no burn => effectively infinite runway
  return Math.round((cash / burn) * 100) / 100;
}

export interface EntityRunwayInput {
  entity_id: string;
  base?: string;
}

export async function entityRunway(rc: RunContext, input: EntityRunwayInput): Promise<RunwayReport> {
  guard(rc, "treasury:read", "read", input.entity_id);
  const entity = await requireEntity(rc, input.entity_id);
  const base = (input.base ?? entity.base_currency).toUpperCase();
  const cash = await sumBalancesInBase(rc, base, input.entity_id);
  const feeds = await latestCostFeeds(rc, input.entity_id);
  let burn = 0;
  for (const f of feeds) burn += await convertMinor(rc.db, f.monthly_burn_minor, f.currency, base);
  return {
    scope: "entity",
    entity_id: input.entity_id,
    base_currency: base,
    cash_in_base_minor: cash,
    monthly_burn_in_base_minor: burn,
    runway_months: runwayMonths(cash, burn),
    as_of: now(),
  };
}

export interface GroupRunwayInput {
  base?: string;
}

export async function groupRunway(rc: RunContext, input: GroupRunwayInput): Promise<RunwayReport> {
  guard(rc, "treasury:read", "read");
  const base = (input.base ?? "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) throw new ValidationError("base must be an ISO-4217 code.");
  const cash = await sumBalancesInBase(rc, base);
  const feeds = await latestCostFeeds(rc);
  let burn = 0;
  for (const f of feeds) burn += await convertMinor(rc.db, f.monthly_burn_minor, f.currency, base);
  return {
    scope: "group",
    entity_id: null,
    base_currency: base,
    cash_in_base_minor: cash,
    monthly_burn_in_base_minor: burn,
    runway_months: runwayMonths(cash, burn),
    as_of: now(),
  };
}

export { latestCostFeeds, sumBalancesInBase };
