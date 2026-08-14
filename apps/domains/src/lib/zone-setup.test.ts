import { describe, it, expect } from "bun:test";
import { nameserversMatch, setupDomainZone, type ZoneSetupDeps } from "./zone-setup.js";

describe("nameserversMatch — order/case/trailing-dot-insensitive set compare", () => {
  it("matches the same nameservers in a different order", () => {
    expect(nameserversMatch(["a.org", "b.net"], ["b.net", "a.org"])).toBe(true);
  });

  it("ignores case and trailing dots", () => {
    expect(nameserversMatch(["NS1.AWSDNS.ORG."], ["ns1.awsdns.org"])).toBe(true);
  });

  it("returns false when the sets differ", () => {
    expect(nameserversMatch(["a.org", "b.net"], ["a.org", "c.com"])).toBe(false);
  });

  it("returns false when lengths differ", () => {
    expect(nameserversMatch(["a.org"], ["a.org", "b.net"])).toBe(false);
  });

  it("treats two empty sets as a match", () => {
    expect(nameserversMatch([], [])).toBe(true);
  });
});

// A spy-friendly deps builder. Records calls so tests can assert what happened.
function makeDeps(over: Partial<ZoneSetupDeps> & {
  existing?: { id: string; name_servers: string[] } | null;
  registrarNs?: string[];
}): {
  deps: ZoneSetupDeps;
  calls: { created: number; nsSet: Array<{ domain: string; ns: string[] }> };
} {
  const calls = { created: 0, nsSet: [] as Array<{ domain: string; ns: string[] }> };
  const deps: ZoneSetupDeps = {
    findExistingZone: over.findExistingZone ?? (async () => over.existing ?? null),
    createZone:
      over.createZone ??
      (async (domain: string) => {
        calls.created++;
        return { id: "ZNEW", name_servers: ["ns-new-1.org", "ns-new-2.net"] };
      }),
    getRegistrarNs: over.getRegistrarNs ?? (async () => over.registrarNs ?? []),
    setRegistrarNs:
      over.setRegistrarNs ??
      (async (domain: string, ns: string[]) => {
        calls.nsSet.push({ domain, ns });
      }),
  };
  return { deps, calls };
}

describe("setupDomainZone — never duplicates the auto-created registration zone", () => {
  it("REGRESSION: reuses the existing (auto-created) zone instead of creating a second one", async () => {
    // Route 53 auto-creates a hosted zone at registration; the registry already
    // delegates to it, so NS already match.
    const existing = { id: "ZAUTO", name_servers: ["ns-1.org", "ns-2.net"] };
    const { deps, calls } = makeDeps({ existing, registrarNs: ["ns-2.net", "ns-1.org"] });

    const res = await setupDomainZone("tokenos.dev", deps);

    expect(res.zoneId).toBe("ZAUTO");
    expect(res.created).toBe(false); // <-- the bug was: it always created a new zone
    expect(res.nsUpdated).toBe(false); // NS already aligned -> no needless update
    expect(calls.created).toBe(0);
    expect(calls.nsSet).toHaveLength(0);
  });

  it("creates a zone when none exists, then aligns the registry NS to it", async () => {
    const { deps, calls } = makeDeps({ existing: null, registrarNs: ["ns-old-1.org", "ns-old-2.net"] });

    const res = await setupDomainZone("fresh.dev", deps);

    expect(res.created).toBe(true);
    expect(res.zoneId).toBe("ZNEW");
    expect(res.nsUpdated).toBe(true);
    expect(calls.created).toBe(1);
    expect(calls.nsSet).toEqual([{ domain: "fresh.dev", ns: ["ns-new-1.org", "ns-new-2.net"] }]);
  });

  it("reuses an existing zone but repairs NS drift (the exact tokenos.dev failure)", async () => {
    // Existing managed zone, but registry delegates elsewhere (e.g. a duplicate
    // auto zone). Reuse the managed zone AND fix the delegation.
    const existing = { id: "ZMANAGED", name_servers: ["ns-m-1.org", "ns-m-2.net"] };
    const { deps, calls } = makeDeps({ existing, registrarNs: ["ns-other-1.org", "ns-other-2.net"] });

    const res = await setupDomainZone("tokenos.dev", deps);

    expect(res.created).toBe(false);
    expect(res.zoneId).toBe("ZMANAGED");
    expect(res.nsUpdated).toBe(true);
    expect(calls.created).toBe(0);
    expect(calls.nsSet).toEqual([{ domain: "tokenos.dev", ns: ["ns-m-1.org", "ns-m-2.net"] }]);
  });
});
