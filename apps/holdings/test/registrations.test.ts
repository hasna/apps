import { describe, expect, it } from "bun:test";
import { seedFixture } from "./helpers/harness.js";
import {
  createRegistration,
  getRegistrationById,
  listRegistrationsService,
  updateRegistrationService,
} from "../src/services/registrations.js";

describe("registrations service", () => {
  it("files a per-jurisdiction registration anchored to an asset", () => {
    const { ctx, assetId } = seedFixture();
    const reg = createRegistration(ctx, {
      asset_id: assetId,
      jurisdiction: "US",
      office: "USPTO",
      kind: "application",
      app_number: "97/123456",
      filing_date: "2026-01-15",
    });
    expect(reg.jurisdiction).toBe("US");
    expect(reg.office).toBe("USPTO");
    expect(reg.status).toBe("filed");
    expect(getRegistrationById(ctx, reg.id).app_number).toBe("97/123456");
  });

  it("rejects a registration for a missing asset", () => {
    const { ctx } = seedFixture();
    expect(() => createRegistration(ctx, { asset_id: "22222222-2222-4222-8222-222222222222", jurisdiction: "EU" })).toThrow(/asset not found/);
  });

  it("rejects a malformed filing date", () => {
    const { ctx, assetId } = seedFixture();
    expect(() => createRegistration(ctx, { asset_id: assetId, jurisdiction: "EU", filing_date: "15-01-2026" })).toThrow();
  });

  it("filters by asset and status and transitions to registered", () => {
    const { ctx, assetId } = seedFixture();
    const reg = createRegistration(ctx, { asset_id: assetId, jurisdiction: "EU", office: "EUIPO" });
    const updated = updateRegistrationService(ctx, {
      id: reg.id,
      status: "registered",
      reg_number: "0181XXXX",
      registration_date: "2026-06-01",
    });
    expect(updated.status).toBe("registered");
    expect(updated.reg_number).toBe("0181XXXX");

    const registered = listRegistrationsService(ctx, { asset_id: assetId, status: "registered" });
    expect(registered.length).toBe(1);
  });
});
