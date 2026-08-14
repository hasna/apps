import { describe, it, expect } from "bun:test";
import { ensureZone, type CloudflareZone } from "./cloudflare.js";

const ZONE: CloudflareZone = { id: "z1", name: "example.com", status: "active", nameservers: ["a.ns.cloudflare.com", "b.ns.cloudflare.com"] };

describe("ensureZone", () => {
  it("reuses an existing zone (no create)", async () => {
    let created = false;
    const z = await ensureZone("example.com", {}, {
      getZone: async () => ZONE,
      createZone: async () => { created = true; return ZONE; },
    });
    expect(z.id).toBe("z1");
    expect(created).toBe(false);
  });

  it("creates a zone when none exists", async () => {
    const z = await ensureZone("example.com", {}, {
      getZone: async () => null,
      createZone: async () => ZONE,
    });
    expect(z.nameservers).toEqual(["a.ns.cloudflare.com", "b.ns.cloudflare.com"]);
  });

  it("throws if the zone has no nameservers", async () => {
    await expect(ensureZone("example.com", {}, {
      getZone: async () => ({ ...ZONE, nameservers: [] }),
      createZone: async () => ZONE,
    })).rejects.toThrow(/no nameservers/);
  });
});
