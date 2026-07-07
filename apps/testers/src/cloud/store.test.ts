import { afterEach, describe, expect, it } from "bun:test";
import { isCloud, resetTestersStore, resolveTestersStore } from "./store.js";

const CLIENT_ENV = [
  "HASNA_TESTERS_STORAGE_MODE",
  "HASNA_TESTERS_MODE",
  "HASNA_TESTERS_API_URL",
  "HASNA_TESTERS_API_KEY",
  "TESTERS_API_URL",
  "TESTERS_API_KEY",
];

function clearEnv(): void {
  for (const k of CLIENT_ENV) delete process.env[k];
  resetTestersStore();
}

afterEach(clearEnv);

describe("testers client storage resolver", () => {
  it("defaults to the local store when nothing is set", () => {
    clearEnv();
    const r = resolveTestersStore();
    expect(r.transport).toBe("local");
    expect(r.client).toBeNull();
    expect(isCloud()).toBe(false);
  });

  it("stays local in self_hosted mode without an API key (no silent drift)", () => {
    clearEnv();
    process.env.HASNA_TESTERS_STORAGE_MODE = "self_hosted";
    process.env.HASNA_TESTERS_API_URL = "https://testers.hasna.xyz";
    expect(() => resolveTestersStore()).toThrow();
  });

  it("routes to the cloud /v1 API in self_hosted mode with URL + key", () => {
    clearEnv();
    process.env.HASNA_TESTERS_STORAGE_MODE = "self_hosted";
    process.env.HASNA_TESTERS_API_URL = "https://testers.hasna.xyz";
    process.env.HASNA_TESTERS_API_KEY = "hasna_testers_test_key";
    const r = resolveTestersStore();
    expect(r.transport).toBe("cloud-http");
    expect(isCloud()).toBe(true);
    if (r.transport === "cloud-http") {
      expect(r.client.baseUrl).toBe("https://testers.hasna.xyz/v1");
      expect(r.client.name).toBe("testers");
    }
  });

  it("accepts the canonical cloud alias too", () => {
    clearEnv();
    process.env.HASNA_TESTERS_STORAGE_MODE = "cloud";
    process.env.HASNA_TESTERS_API_URL = "https://testers.hasna.xyz";
    process.env.HASNA_TESTERS_API_KEY = "hasna_testers_test_key";
    expect(resolveTestersStore().transport).toBe("cloud-http");
  });
});
