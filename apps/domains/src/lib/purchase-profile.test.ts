import { describe, it, expect, afterEach } from "bun:test";
import { applyPurchaseProfile, getPurchaseProfile } from "./config.js";

afterEach(() => { delete process.env["AWS_PROFILE"]; delete process.env["AWS_ACCESS_KEY_ID"]; delete process.env["DOMAINS_PURCHASE_AWS_PROFILE"]; });

describe("purchase profile", () => {
  it("getPurchaseProfile reads env override", () => {
    process.env["DOMAINS_PURCHASE_AWS_PROFILE"] = "hasna-xyz-infra";
    expect(getPurchaseProfile()).toBe("hasna-xyz-infra");
  });
  it("applyPurchaseProfile sets AWS_PROFILE when no creds present", () => {
    process.env["DOMAINS_PURCHASE_AWS_PROFILE"] = "hasna-xyz-infra";
    expect(applyPurchaseProfile()).toBe("hasna-xyz-infra");
    expect(process.env["AWS_PROFILE"]).toBe("hasna-xyz-infra");
  });
  it("applyPurchaseProfile does NOT override explicit AWS_ACCESS_KEY_ID", () => {
    process.env["AWS_ACCESS_KEY_ID"] = "fake-test-key-id";
    process.env["DOMAINS_PURCHASE_AWS_PROFILE"] = "hasna-xyz-infra";
    applyPurchaseProfile();
    expect(process.env["AWS_PROFILE"]).toBeUndefined();
  });
});
