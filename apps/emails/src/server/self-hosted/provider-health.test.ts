import { expect, it } from "bun:test";
import { readProviderHealth } from "./provider-health.js";
import type { TenantScopedStore } from "./store.js";
const store = { getResource: async (_spec: unknown, id: string) => id === "provider" ? { name: "fixture", type: "ses", active: true } : null } as unknown as TenantScopedStore;
it("distinguishes unconfigured, configured, restricted and healthy using the bound sender", async () => {
  expect((await readProviderHealth(store, "tenant", "provider", true))?.status).toBe("unconfigured");
  let calls = 0;
  const resolve = () => ({ provider: "ses" as const, send: async () => "never", probe: async () => { calls++; return { sendingEnabled: false, productionAccessEnabled: false }; } });
  expect((await readProviderHealth(store, "tenant", "provider", false, resolve))?.status).toBe("configured");
  expect(calls).toBe(0);
  expect((await readProviderHealth(store, "tenant", "provider", true, resolve))?.status).toBe("restricted");
  expect(calls).toBe(1);
  expect(await readProviderHealth(store, "tenant", "other", true, resolve)).toBeNull();
});
it("does not expose provider exception content and bounds hung probes", async () => {
  const resolve = () => ({ provider: "ses" as const, send: async () => "never", probe: async () => { throw new Error("sensitive fixture detail"); } });
  const failed = await readProviderHealth(store, "tenant", "provider", true, resolve);
  expect(failed?.status).toBe("unhealthy");
  expect(JSON.stringify(failed)).not.toContain("sensitive fixture");
  const hung = await readProviderHealth(store, "tenant", "provider", true, () => ({ ...resolve(), probe: () => new Promise(() => {}) }), 5);
  expect(hung?.message).toContain("timed out");
});
