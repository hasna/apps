import { expect, it } from "bun:test";
import { syncProviderDelivery } from "./provider-sync.js";
import type { TenantScopedStore } from "./store.js";
it("reports partial pages and provider faults without claiming completeness", async () => {
  const seen: string[] = [];
  const store = {
    getResource: async () => ({ type: "resend", active: true }),
    listDeliverySyncMessages: async () => [{ id: "a", provider_message_id: "remote-a" }, { id: "b", provider_message_id: "remote-b" }, { id: "c", provider_message_id: "remote-c" }],
    applyDeliveryObservations: async () => ({ inserted: 1, contacts_updated: 0, unattributed: 0 }),
  } as unknown as TenantScopedStore;
  const result = await syncProviderDelivery(store, "tenant", "provider", { limit: 2, resolveSender: async () => ({ provider: "resend", send: async () => "never", readDelivery: async (id) => { seen.push(id); if (id === "remote-b") throw new Error("private exception"); return { observations: [{ type: "delivered" }], evidence: "current_status" }; } }) });
  expect(result).toMatchObject({ status: "partial", complete: false, checked: 1, synced: 1, next_cursor: "b" });
  expect(seen).toEqual(["remote-a", "remote-b"]);
  expect(JSON.stringify(result)).not.toContain("private exception");
});
it("does not call any provider for an unknown tenant provider", async () => {
  const store = { getResource: async () => null } as unknown as TenantScopedStore;
  await expect(syncProviderDelivery(store, "tenant", "other", { resolveSender: () => { throw new Error("must not resolve"); } })).rejects.toThrow("Provider not found");
});
