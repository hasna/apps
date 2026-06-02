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

  it("godaddy is gated for purchase (2024+ API restriction)", () => {
    const c = getCapability("godaddy");
    expect(c.gated).toBe(true);
  });

  it("brandsight is enterprise-contract-only (gated)", () => {
    const c = getCapability("brandsight");
    expect(c.gated).toBe(true);
    expect(c.notes).toMatch(/enterprise|contract/i);
  });

  it("cloudflare manages DNS but cannot buy", () => {
    const c = getCapability("cloudflare");
    expect(c.canDns).toBe(true);
    expect(c.canBuy).toBe(false);
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
    expect(() => selectBuyRegistrar("brandsight")).toThrow(/gated|enterprise|not available/i);
  });

  it("selectDnsProvider is always cloudflare (always-Cloudflare-DNS rule)", () => {
    expect(selectDnsProvider()).toBe("cloudflare");
  });

  it("canBuy reflects the matrix", () => {
    expect(canBuy("route53")).toBe(true);
    expect(canBuy("brandsight")).toBe(false);
  });
});
