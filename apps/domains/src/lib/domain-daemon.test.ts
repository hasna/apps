import { describe, it, expect } from "bun:test";
import { reconcileDomainTick, type DomainReconcileDeps } from "./domain-daemon.js";
import type { DomainSignals } from "./provision-state.js";

function depsFor(signalsByDomain: Record<string, DomainSignals>, actions: string[]): DomainReconcileDeps {
  return {
    gatherSignals: async (d) => signalsByDomain[d] ?? {},
    runAction: async (d, action) => { actions.push(`${d}:${action}`); },
  };
}

describe("reconcileDomainTick", () => {
  it("runs the next action for each non-terminal domain", async () => {
    const actions: string[] = [];
    const deps = depsFor({
      "a.com": { registered: false },                      // requested -> register
      "b.com": { registered: true },                       // registered -> create_cf_zone
      "c.com": { registered: true, zoneExists: true, registrarNsAreCloudflare: true, publicNsAreCloudflare: true, zoneActive: true }, // ready
    }, actions);

    const res = await reconcileDomainTick(["a.com", "b.com", "c.com"], deps);
    expect(actions).toContain("a.com:register");
    expect(actions).toContain("b.com:create_cf_zone");
    expect(res.processed).toBe(3);
    expect(res.advanced).toBe(2);     // a + b acted; c already ready
    expect(res.ready).toBe(1);        // c
  });

  it("counts errors and keeps going", async () => {
    const actions: string[] = [];
    const deps: DomainReconcileDeps = {
      gatherSignals: async () => ({ registered: true }),
      runAction: async (d) => { if (d === "bad.com") throw new Error("boom"); actions.push(d); },
    };
    const res = await reconcileDomainTick(["good.com", "bad.com"], deps);
    expect(res.errors).toBe(1);
    expect(actions).toEqual(["good.com"]);
  });

  it("is a no-op when all domains are ready", async () => {
    const ready: DomainSignals = { registered: true, zoneExists: true, registrarNsAreCloudflare: true, publicNsAreCloudflare: true, zoneActive: true };
    const res = await reconcileDomainTick(["x.com"], depsFor({ "x.com": ready }, []));
    expect(res.advanced).toBe(0);
    expect(res.ready).toBe(1);
  });
});
