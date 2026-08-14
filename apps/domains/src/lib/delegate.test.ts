import { describe, it, expect } from "bun:test";
import { delegateDomainToCloudflare, type DelegateDeps } from "./delegate.js";

describe("delegateDomainToCloudflare", () => {
  it("creates a Cloudflare zone and points the registrar NS at it", async () => {
    const calls: string[] = [];
    const deps: DelegateDeps = {
      createCloudflareZone: async (domain) => {
        calls.push(`zone:${domain}`);
        return { id: "zone-1", nameservers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"] };
      },
      updateNameservers: async (domain, ns) => {
        calls.push(`ns:${domain}:${ns.join(",")}`);
        return { operationId: "op-9" };
      },
    };

    const res = await delegateDomainToCloudflare("example.com", deps);

    expect(res).toEqual({
      zoneId: "zone-1",
      nameservers: ["amy.ns.cloudflare.com", "bob.ns.cloudflare.com"],
      operationId: "op-9",
    });
    expect(calls).toEqual([
      "zone:example.com",
      "ns:example.com:amy.ns.cloudflare.com,bob.ns.cloudflare.com",
    ]);
  });

  it("reuses an existing zone when the deps return one (idempotent)", async () => {
    const deps: DelegateDeps = {
      createCloudflareZone: async () => ({ id: "existing", nameservers: ["x.ns.cloudflare.com"] }),
      updateNameservers: async () => ({ operationId: "op" }),
    };
    const res = await delegateDomainToCloudflare("example.com", deps);
    expect(res.zoneId).toBe("existing");
  });

  it("throws when the zone has no nameservers (cannot delegate)", async () => {
    const deps: DelegateDeps = {
      createCloudflareZone: async () => ({ id: "z", nameservers: [] }),
      updateNameservers: async () => ({ operationId: "op" }),
    };
    await expect(delegateDomainToCloudflare("example.com", deps)).rejects.toThrow(/no nameservers/);
  });
});
