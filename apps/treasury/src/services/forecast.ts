import { now } from "../db/database.js";
import { guard, type RunContext } from "./context.js";
import { entityRunway, groupRunway } from "./runway.js";
import { ValidationError, type CashForecast, type ForecastPoint } from "../types/index.js";

const MAX_HORIZON = 36;

function monthLabel(offset: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function project(starting: number, burn: number, horizon: number): ForecastPoint[] {
  const points: ForecastPoint[] = [];
  for (let m = 0; m <= horizon; m++) {
    points.push({ month_index: m, month: monthLabel(m), projected_cash_in_base_minor: starting - burn * m });
  }
  return points;
}

export interface ForecastInput {
  entity_id?: string;
  base?: string;
  horizon_months?: number;
}

/** Short-horizon linear cash projection from current cash minus monthly burn. */
export async function cashForecast(rc: RunContext, input: ForecastInput): Promise<CashForecast> {
  guard(rc, "treasury:read", "read", input.entity_id);
  const horizon = input.horizon_months ?? 6;
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > MAX_HORIZON) {
    throw new ValidationError(`horizon_months must be an integer in 1..${MAX_HORIZON}.`);
  }
  const runway = input.entity_id
    ? await entityRunway(rc, { entity_id: input.entity_id, ...(input.base ? { base: input.base } : {}) })
    : await groupRunway(rc, { ...(input.base ? { base: input.base } : {}) });
  return {
    scope: runway.scope,
    entity_id: runway.entity_id,
    base_currency: runway.base_currency,
    horizon_months: horizon,
    starting_cash_in_base_minor: runway.cash_in_base_minor,
    monthly_burn_in_base_minor: runway.monthly_burn_in_base_minor,
    points: project(runway.cash_in_base_minor, runway.monthly_burn_in_base_minor, horizon),
    as_of: now(),
  };
}
