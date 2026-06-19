import { describe, it, expect } from "bun:test";
import {
  PROVIDER_CAPABILITIES,
  getCapability,
  selectBuyRegistrar,
  selectDnsProvider,
  canBuy,
} from "./capability.js";

describe("provider capability matrix", () => {
  it("route53 can buy and is not gated", () => {
    const c = getCapability("route53");
    expect(c.canBuy).toBe(true);
    expect(c.gated).toBe(false);
  });

  it("godaddy is gated and not a direct CLI purchase path", () => {
    const c = getCapability("godaddy");
    expect(c.gated).toBe(true);
    expect(c.canBuy).toBe(false);
  });

  it("brandsight has an enterprise-contract-only buy path (gated)", () => {
    const c = getCapability("brandsight");
    expect(c.gated).toBe(true);
    expect(c.canBuy).toBe(true);
    expect(c.canDns).toBe(true);
    expect(c.notes).toMatch(/enterprise|contract/i);
  });

  it("cloudflare manages DNS but cannot buy", () => {
    const c = getCapability("cloudflare");
    expect(c.canDns).toBe(true);
    expect(c.canBuy).toBe(false);
  });

  it("sedo is marketplace-only, not registrar DNS", () => {
    const c = getCapability("sedo");
    expect(c.canBuy).toBe(false);
    expect(c.canDns).toBe(false);
    expect(c.notes).toMatch(/marketplace|recorded purchases/i);
  });

  it("every provider in the matrix has the required shape", () => {
    for (const name of Object.keys(PROVIDER_CAPABILITIES)) {
      const c = getCapability(name);
      expect(typeof c.canBuy).toBe("boolean");
      expect(typeof c.canDns).toBe("boolean");
      expect(typeof c.gated).toBe("boolean");
    }
  });
});

describe("auto-select", () => {
  it("selectBuyRegistrar prefers route53 (only reliable self-serve)", () => {
    expect(selectBuyRegistrar()).toBe("route53");
  });

  it("selectBuyRegistrar honors an explicit non-gated preference", () => {
    expect(selectBuyRegistrar("route53")).toBe("route53");
  });

  it("selectBuyRegistrar rejects a gated preference with a clear error", () => {
    expect(() => selectBuyRegistrar("brandsight")).toThrow(/cannot buy|gated|enterprise|not available/i);
  });

  it("selectDnsProvider defaults to cloudflare", () => {
    expect(selectDnsProvider()).toBe("cloudflare");
  });

  it("selectDnsProvider honors non-gated DNS preferences", () => {
    expect(selectDnsProvider("route53")).toBe("route53");
  });

  it("canBuy reflects the matrix", () => {
    expect(canBuy("route53")).toBe(true);
    expect(canBuy("brandsight")).toBe(false);
  });
});
