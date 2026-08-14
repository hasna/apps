import { describe, expect, it } from "bun:test";
import { seedFixture } from "./helpers/harness.js";
import {
  createRenewal,
  listRenewalsService,
  updateRenewalService,
  upcomingRenewals,
} from "../src/services/renewals.js";

describe("renewals service (deadline tracking)", () => {
  it("creates a renewal with default reminder window", () => {
    const { ctx, assetId } = seedFixture();
    const renewal = createRenewal(ctx, { asset_id: assetId, due_date: "2027-01-15", fee_amount: 525, fee_currency: "USD" });
    expect(renewal.status).toBe("upcoming");
    expect(renewal.reminder_days).toBe(30);
    expect(renewal.fee_amount).toBe(525);
  });

  it("surfaces upcoming renewals within the horizon, sorted by due date", () => {
    const { ctx, assetId } = seedFixture();
    const asOf = "2026-07-06";
    createRenewal(ctx, { asset_id: assetId, due_date: "2026-08-01" }); // ~26 days
    createRenewal(ctx, { asset_id: assetId, due_date: "2026-07-20" }); // ~14 days
    createRenewal(ctx, { asset_id: assetId, due_date: "2027-06-01" }); // > 90 days out

    const upcoming = upcomingRenewals(ctx, { within_days: 90, as_of: asOf });
    expect(upcoming.length).toBe(2);
    expect(upcoming[0]!.due_date).toBe("2026-07-20");
    expect(upcoming[0]!.days_until_due).toBe(14);
    expect(upcoming[0]!.asset_name).toBe("HASNA");
  });

  it("excludes completed renewals from the upcoming view", () => {
    const { ctx, assetId } = seedFixture();
    const r = createRenewal(ctx, { asset_id: assetId, due_date: "2026-07-20" });
    updateRenewalService(ctx, { id: r.id, status: "completed" });
    const upcoming = upcomingRenewals(ctx, { within_days: 365, as_of: "2026-07-06" });
    expect(upcoming.length).toBe(0);
    expect(listRenewalsService(ctx, { asset_id: assetId, status: "completed" }).length).toBe(1);
  });

  it("rejects a negative fee", () => {
    const { ctx, assetId } = seedFixture();
    expect(() => createRenewal(ctx, { asset_id: assetId, due_date: "2027-01-01", fee_amount: -1 })).toThrow();
  });
});
