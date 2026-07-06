import { afterEach, describe, expect, it } from "bun:test";
import { seedFixture, type Fixture } from "./helpers.js";
import { consolidatedBalances } from "../src/services/balances.js";
import { fxExposure } from "../src/services/fx.js";
import { entityRunway, groupRunway } from "../src/services/runway.js";
import { cashForecast } from "../src/services/forecast.js";
import { listSweeps } from "../src/services/sweeps.js";

let fx: Fixture;
afterEach(() => fx?.cleanup());

describe("treasury domain (golden fixtures)", () => {
  it("consolidates balances across entities and currencies into a base", async () => {
    fx = await seedFixture();
    const c = await consolidatedBalances(fx.owner, { base: "USD" });
    // US: 250k + 30k USD = 280k USD. RO: 15k EUR -> /0.92 ≈ 16304.35 USD.
    const eurInUsd = Math.round(15_000_00 / 0.92);
    expect(c.total_in_base_minor).toBe(280_000_00 + eurInUsd);
    expect(c.by_currency.map((x) => x.currency).sort()).toEqual(["EUR", "USD"]);
  });

  it("reports FX exposure per currency", async () => {
    fx = await seedFixture();
    const e = await fxExposure(fx.owner, { base: "USD" });
    const eur = e.exposures.find((x) => x.currency === "EUR");
    expect(eur?.total_minor).toBe(15_000_00);
    expect(eur?.in_base_minor).toBe(Math.round(15_000_00 / 0.92));
  });

  it("computes per-entity and group runway", async () => {
    fx = await seedFixture();
    const us = await entityRunway(fx.owner, { entity_id: fx.usId, base: "USD" });
    // US cash 280k, burn 10k/mo => 28 months.
    expect(us.runway_months).toBe(28);
    const group = await groupRunway(fx.owner, { base: "USD" });
    expect(group.scope).toBe("group");
    expect(group.runway_months).toBeGreaterThan(0);
  });

  it("projects a short-horizon cash forecast", async () => {
    fx = await seedFixture();
    const f = await cashForecast(fx.owner, { entity_id: fx.usId, base: "USD", horizon_months: 3 });
    expect(f.points).toHaveLength(4);
    expect(f.points[0]!.projected_cash_in_base_minor).toBe(280_000_00);
    expect(f.points[3]!.projected_cash_in_base_minor).toBe(280_000_00 - 3 * 10_000_00);
  });

  it("generates advisory sweep recommendations flagged for controls authorization", async () => {
    fx = await seedFixture();
    const sweeps = await listSweeps(fx.owner, {});
    expect(sweeps.length).toBeGreaterThan(0);
    for (const s of sweeps) {
      expect(s.requires_controls_authorization).toBe(true);
      expect(s.amount_minor).toBeGreaterThan(0);
      expect(s.from_entity_id).not.toBe(s.to_entity_id);
    }
  });
});
