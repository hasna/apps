import { describe, expect, it } from "bun:test";
import {
  getAvailableProviders,
  getDnsProvider,
  getDomainInventoryProvider,
  getRegistrarProvider,
  providerHasDns,
  providerHasInventory,
  providerHasRegistrar,
} from "./registrar.js";

describe("provider registry contract", () => {
  it("keeps provider info aligned with adapter factories", () => {
    for (const provider of getAvailableProviders()) {
      expect(provider.inventory).toBe(providerHasInventory(provider.name));
      if (provider.type === "dns" || provider.type === "full") expect(providerHasDns(provider.name)).toBe(true);
      if (provider.type === "registrar" || provider.type === "full") expect(providerHasRegistrar(provider.name)).toBe(true);
    }
  });

  it("inventory providers expose list and sync methods", () => {
    for (const provider of getAvailableProviders().filter((p) => p.inventory)) {
      const adapter = getDomainInventoryProvider(provider.name);
      expect(typeof adapter.listDomains).toBe("function");
      expect(typeof adapter.syncToLocalDb).toBe("function");
    }
  });

  it("registrar and dns providers expose required operations", () => {
    for (const provider of getAvailableProviders()) {
      if (providerHasRegistrar(provider.name)) {
        const adapter = getRegistrarProvider(provider.name);
        expect(typeof adapter.checkAvailability).toBe("function");
        expect(typeof adapter.listDomains).toBe("function");
        expect(typeof adapter.renewDomain).toBe("function");
      }
      if (providerHasDns(provider.name)) {
        const adapter = getDnsProvider(provider.name);
        expect(typeof adapter.getDnsRecords).toBe("function");
        expect(typeof adapter.setDnsRecords).toBe("function");
      }
    }
  });
});
