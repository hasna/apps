import { now, uuid } from "../db/database.js";
import { appendAudit } from "../db/audit.js";
import { guard, type RunContext } from "./context.js";
import { listEntities } from "./entities.js";
import { entityRunway } from "./runway.js";
import { entityFilter } from "./fx.js";
import { SweepNotFoundError, ValidationError, type SweepRecommendation, type SweepStatus } from "../types/index.js";

function hydrate(row: SweepRecommendation): SweepRecommendation {
  return { ...row, requires_controls_authorization: true };
}

export async function listSweeps(rc: RunContext, input: { status?: SweepStatus }): Promise<SweepRecommendation[]> {
  guard(rc, "treasury:read", "read");
  const { clause, params } = entityFilter(rc, "from_entity_id");
  let sql = `SELECT * FROM sweep_recommendations ${clause}`;
  const args = [...params];
  if (input.status) {
    sql += clause ? " AND status = ?" : "WHERE status = ?";
    args.push(input.status);
  }
  sql += " ORDER BY created_at DESC";
  const rows = await rc.db.all<SweepRecommendation>(sql, args);
  return rows.map(hydrate);
}

export async function getSweep(rc: RunContext, input: { id: string }): Promise<SweepRecommendation> {
  guard(rc, "treasury:read", "read");
  const row = await rc.db.get<SweepRecommendation>("SELECT * FROM sweep_recommendations WHERE id = ?", [input.id]);
  if (!row) throw new SweepNotFoundError(input.id);
  guardEntity(rc, row.from_entity_id);
  return hydrate(row);
}

function guardEntity(rc: RunContext, entity_id: string): void {
  if (rc.auth.bypass) return;
  if (!rc.auth.entity_ids?.includes(entity_id)) {
    throw new SweepNotFoundError("access denied");
  }
}

export interface GenerateSweepsInput {
  base?: string;
  min_runway_months?: number;
  healthy_runway_months?: number;
}

/**
 * Generate intercompany-funding RECOMMENDATIONS (advisory only — treasury never
 * moves money; execution must be requested through iapp-controls). Lifts
 * short-runway entities toward `min_runway_months` funded by entities holding a
 * surplus above `healthy_runway_months`.
 */
export async function generateSweeps(rc: RunContext, input: GenerateSweepsInput): Promise<SweepRecommendation[]> {
  guard(rc, "treasury:recommend", "recommend");
  const base = (input.base ?? "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) throw new ValidationError("base must be an ISO-4217 code.");
  const minRunway = input.min_runway_months ?? 3;
  const healthy = input.healthy_runway_months ?? 12;
  if (minRunway <= 0 || healthy <= minRunway) throw new ValidationError("healthy_runway_months must be greater than min_runway_months (> 0).");

  const entities = await listEntities(rc);
  const needy: Array<{ id: string; need: number }> = [];
  const donors: Array<{ id: string; surplus: number }> = [];
  for (const e of entities) {
    const r = await entityRunway(rc, { entity_id: e.entity_id, base });
    const burn = r.monthly_burn_in_base_minor;
    const cash = r.cash_in_base_minor;
    if (burn > 0) {
      const need = Math.max(0, Math.round(minRunway * burn) - cash);
      const surplus = Math.max(0, cash - Math.round(healthy * burn));
      if (need > 0) needy.push({ id: e.entity_id, need });
      else if (surplus > 0) donors.push({ id: e.entity_id, surplus });
    } else if (cash > 0) {
      donors.push({ id: e.entity_id, surplus: cash });
    }
  }

  // Clear prior open recommendations in scope, then regenerate deterministically.
  const { clause, params } = entityFilter(rc, "from_entity_id");
  await rc.db.run(
    `DELETE FROM sweep_recommendations ${clause}${clause ? " AND" : "WHERE"} status = 'recommended'`,
    [...params],
  );

  needy.sort((a, b) => b.need - a.need);
  donors.sort((a, b) => b.surplus - a.surplus);
  const recs: SweepRecommendation[] = [];
  let di = 0;
  for (const n of needy) {
    let remaining = n.need;
    while (remaining > 0 && di < donors.length) {
      const donor = donors[di]!;
      if (donor.surplus <= 0) {
        di++;
        continue;
      }
      const amount = Math.min(remaining, donor.surplus);
      donor.surplus -= amount;
      remaining -= amount;
      const ts = now();
      const rec: SweepRecommendation = {
        id: uuid(),
        from_entity_id: donor.id,
        to_entity_id: n.id,
        currency: base,
        amount_minor: amount,
        rationale: `Lift ${n.id} toward ${input.min_runway_months ?? 3}mo runway from ${donor.id} surplus.`,
        status: "recommended",
        requires_controls_authorization: true,
        created_at: ts,
        updated_at: ts,
      };
      await rc.db.run(
        "INSERT INTO sweep_recommendations (id, from_entity_id, to_entity_id, currency, amount_minor, rationale, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [rec.id, rec.from_entity_id, rec.to_entity_id, rec.currency, rec.amount_minor, rec.rationale, rec.status, rec.created_at, rec.updated_at],
      );
      await appendAudit(rc.db, { entity_id: donor.id, actor_id: rc.auth.actor_id, action: "sweep.recommend", detail: `${donor.id}->${n.id} ${base} ${amount}` });
      recs.push(rec);
      if (donor.surplus <= 0) di++;
    }
  }
  return recs;
}

export interface UpdateSweepInput {
  id: string;
  status: SweepStatus;
}

export async function updateSweepStatus(rc: RunContext, input: UpdateSweepInput): Promise<SweepRecommendation> {
  guard(rc, "treasury:recommend", "recommend");
  if (!["recommended", "acknowledged", "dismissed"].includes(input.status)) {
    throw new ValidationError("status must be one of: recommended, acknowledged, dismissed.");
  }
  const row = await rc.db.get<SweepRecommendation>("SELECT * FROM sweep_recommendations WHERE id = ?", [input.id]);
  if (!row) throw new SweepNotFoundError(input.id);
  guardEntity(rc, row.from_entity_id);
  const updated_at = now();
  await rc.db.run("UPDATE sweep_recommendations SET status = ?, updated_at = ? WHERE id = ?", [input.status, updated_at, input.id]);
  await appendAudit(rc.db, { entity_id: row.from_entity_id, actor_id: rc.auth.actor_id, action: "sweep.status", detail: `${input.id} -> ${input.status}` });
  return hydrate({ ...row, status: input.status, updated_at });
}
