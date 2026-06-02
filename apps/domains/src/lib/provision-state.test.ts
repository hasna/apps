import { describe, it, expect } from "bun:test";
import {
  DOMAIN_FLOW,
  domainNext,
  domainActionFor,
  isDomainTerminal,
  domainHappyPath,
  deriveDomainState,
  type DomainProvState,
} from "./provision-state.js";

describe("domain provisioning state machine", () => {
  it("walks requested -> ready", () => {
    const path: DomainProvState[] = [];
    let s: DomainProvState | null = "requested";
    while (s && !isDomainTerminal(s)) { path.push(s); s = domainNext(s); }
    path.push("ready");
    expect(path).toEqual([
      "requested", "registered", "cf_zone_ready", "ns_delegated", "ns_propagated", "dns_managed", "ready",
    ]);
  });

  it("maps states to actions", () => {
    expect(domainActionFor("requested")).toBe("register");
    expect(domainActionFor("registered")).toBe("create_cf_zone");
    expect(domainActionFor("cf_zone_ready")).toBe("delegate_ns");
    expect(domainActionFor("ns_delegated")).toBe("check_ns_propagation");
    expect(domainActionFor("ns_propagated")).toBe("verify_dns");
  });

  it("ready/failed are terminal with no action", () => {
    expect(isDomainTerminal("ready")).toBe(true);
    expect(isDomainTerminal("failed")).toBe(true);
    expect(domainActionFor("ready")).toBeNull();
    expect(domainNext("ready")).toBeNull();
  });

  it("happy path includes terminal ready", () => {
    expect(domainHappyPath().at(-1)).toBe("ready");
  });
});

describe("deriveDomainState — from live signals", () => {
  it("requested when not registered", () => {
    expect(deriveDomainState({ registered: false })).toBe("requested");
  });
  it("registered when registered but no zone", () => {
    expect(deriveDomainState({ registered: true })).toBe("registered");
  });
  it("cf_zone_ready when zone exists but NS not delegated", () => {
    expect(deriveDomainState({ registered: true, zoneExists: true })).toBe("cf_zone_ready");
  });
  it("ns_delegated when registrar NS point to cloudflare", () => {
    expect(deriveDomainState({ registered: true, zoneExists: true, registrarNsAreCloudflare: true })).toBe("ns_delegated");
  });
  it("ns_propagated when public NS resolve to cloudflare", () => {
    expect(deriveDomainState({ registered: true, zoneExists: true, registrarNsAreCloudflare: true, publicNsAreCloudflare: true })).toBe("ns_propagated");
  });
  it("ready when zone active + DNS verified", () => {
    expect(deriveDomainState({ registered: true, zoneExists: true, registrarNsAreCloudflare: true, publicNsAreCloudflare: true, zoneActive: true })).toBe("ready");
  });
});
