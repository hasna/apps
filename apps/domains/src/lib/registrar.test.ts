import { describe, expect, it } from "bun:test";
import { autoDetectRegistrar, getAvailableProviders, providerHasInventory } from "./registrar.js";
import type { Domain } from "../db/domains.js";

function domain(registrar: string | null): Domain {
  return {
    id: "id",
    name: "example.com",
    registrar,
    status: "active",
    registered_at: null,
    expires_at: null,
    auto_renew: true,
    is_premium: false,
    premium_price: null,
    standard_price: null,
    purchase_price: null,
    purchase_date: null,
    nameservers: [],
    whois: {},
    ssl_expires_at: null,
    ssl_issuer: null,
    notes: null,
    metadata: {},
    created_at: "",
    updated_at: "",
  };
}

describe("provider inventory metadata", () => {
  it("marks sync-capable providers as inventory providers", () => {
    const providers = new Map(getAvailableProviders().map((p) => [p.name, p]));
    expect(providers.get("route53")?.inventory).toBe(true);
    expect(providers.get("cloudflare")?.inventory).toBe(true);
    expect(providers.get("brandsight")?.inventory).toBe(true);
    expect(providers.get("sedo")?.inventory).toBe(false);
    expect(providerHasInventory("cloudflare")).toBe(true);
  });
});

describe("autoDetectRegistrar", () => {
  it("ignores DNS-only and source-only discovery markers", async () => {
    for (const registrar of ["Cloudflare DNS", "AWS Route 53 DNS", "AWS SSM (imported)"]) {
      expect(await autoDetectRegistrar("example.com", async () => domain(registrar))).toBeNull();
    }
  });

  it("detects real registrar names", async () => {
    expect(await autoDetectRegistrar("example.com", async () => domain("AWS Route 53"))).toBe("route53");
    expect(await autoDetectRegistrar("example.com", async () => domain("Brandsight"))).toBe("brandsight");
  });
});
