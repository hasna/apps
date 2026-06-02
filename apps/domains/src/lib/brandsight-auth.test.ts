import { describe, it, expect } from "bun:test";
import { resolveBrandsightConfig, brandsightCapability } from "./brandsight.js";

describe("resolveBrandsightConfig", () => {
  it("reads HASNAXYZ vault names (full GoDaddy-style cred set)", () => {
    const c = resolveBrandsightConfig({
      HASNAXYZ_BRANDSIGHT_LIVE_API_KEY: "k",
      HASNAXYZ_BRANDSIGHT_LIVE_API_SECRET: "s",
      HASNAXYZ_BRANDSIGHT_LIVE_CUSTOMER_ID: "c",
      HASNAXYZ_BRANDSIGHT_LIVE_SHOPPER_ID: "sh",
    });
    expect(c.apiKey).toBe("k");
    expect(c.apiSecret).toBe("s");
    expect(c.customerId).toBe("c");
    expect(c.shopperId).toBe("sh");
  });
  it("prefers explicit BRANDSIGHT_* over vault names", () => {
    expect(resolveBrandsightConfig({ BRANDSIGHT_API_KEY: "direct", HASNAXYZ_BRANDSIGHT_LIVE_API_KEY: "vault" }).apiKey).toBe("direct");
  });
});

describe("brandsightCapability", () => {
  it("is always gated, configured when full creds present", () => {
    const cap = brandsightCapability({
      HASNAXYZ_BRANDSIGHT_LIVE_API_KEY: "k", HASNAXYZ_BRANDSIGHT_LIVE_API_SECRET: "s", HASNAXYZ_BRANDSIGHT_LIVE_CUSTOMER_ID: "c",
    });
    expect(cap.configured).toBe(true);
    expect(cap.gated).toBe(true);
  });
  it("not configured when creds missing", () => {
    expect(brandsightCapability({}).configured).toBe(false);
  });
});
