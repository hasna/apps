import { describe, it, expect } from "bun:test";
import { isCloudflareNs, classifyNsDrift, reconcileNsDrift, type NsReconcileDeps } from "./ns-drift.js";

describe("isCloudflareNs", () => {
  it("true for all-cloudflare NS (trailing dot tolerated)", () => {
    expect(isCloudflareNs(["amy.ns.cloudflare.com", "bob.ns.cloudflare.com."])).toBe(true);
  });
  it("false when any NS is not cloudflare", () => {
    expect(isCloudflareNs(["amy.ns.cloudflare.com", "ns1.godaddy.com"])).toBe(false);
    expect(isCloudflareNs([])).toBe(false);
  });
});

describe("classifyNsDrift", () => {
  it("flags non-cloudflare and empty", () => {
    expect(classifyNsDrift("a.com", ["ns1.godaddy.com"]).drifted).toBe(true);
    expect(classifyNsDrift("a.com", []).drifted).toBe(true);
    expect(classifyNsDrift("a.com", ["x.ns.cloudflare.com", "y.ns.cloudflare.com"]).drifted).toBe(false);
  });
});

describe("reconcileNsDrift", () => {
  const cf = ["x.ns.cloudflare.com", "y.ns.cloudflare.com"];
  it("detects drift without fixing by default", async () => {
    const deps: NsReconcileDeps = {
      getRegistrarNs: async (d) => d === "drift.com" ? ["ns1.godaddy.com"] : cf,
      getCloudflareNs: async () => cf,
      setRegistrarNs: async () => { throw new Error("should not be called"); },
    };
    const res = await reconcileNsDrift(["ok.com", "drift.com"], deps);
    expect(res.drifted.map((d) => d.domain)).toEqual(["drift.com"]);
    expect(res.fixed).toHaveLength(0);
  });
  it("fixes drift when fix:true", async () => {
    const setCalls: string[] = [];
    const deps: NsReconcileDeps = {
      getRegistrarNs: async () => ["ns1.godaddy.com"],
      getCloudflareNs: async () => cf,
      setRegistrarNs: async (d) => { setCalls.push(d); },
    };
    const res = await reconcileNsDrift(["drift.com"], deps, { fix: true });
    expect(res.fixed).toEqual(["drift.com"]);
    expect(setCalls).toEqual(["drift.com"]);
  });
});
