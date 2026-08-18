import { describe, expect, test } from "bun:test";
import { getStore, LocalStore, resolveClientFlip, RETIRED_MODE_KEYS } from "./store.js";

// -- Client transport selection by the env contract ---------------------------
//
// The deployment-mode enum is REMOVED. The client selects its backend by the
// environment: HASNA_DOMAINS_API_URL + HASNA_DOMAINS_API_KEY both set -> hosted
// HTTP client; neither set -> local SQLite; exactly one set -> hard error
// (fail-closed). The retired storage-mode env keys are never read.

const HOSTED = {
  HASNA_DOMAINS_API_URL: "https://domains.example.invalid",
  HASNA_DOMAINS_API_KEY: "not-a-real-key-fixture-only",
};

describe("resolveClientFlip", () => {
  test("both URL and key set resolves hosted", () => {
    const flip = resolveClientFlip(HOSTED);
    expect(flip.hosted).toBe(true);
    expect(flip.urlSource).toBe("HASNA_DOMAINS_API_URL");
    expect(flip.keySource).toBe("HASNA_DOMAINS_API_KEY");
  });

  test("the unprefixed DOMAINS_API_URL + DOMAINS_API_KEY aliases also flip hosted", () => {
    const flip = resolveClientFlip({ DOMAINS_API_URL: "https://api.example", DOMAINS_API_KEY: "key" });
    expect(flip.hosted).toBe(true);
    expect(flip.urlSource).toBe("DOMAINS_API_URL");
    expect(flip.keySource).toBe("DOMAINS_API_KEY");
  });

  test("neither URL nor key set resolves local", () => {
    expect(resolveClientFlip({}).hosted).toBe(false);
    expect(resolveClientFlip({ DOMAINS_DIR: "/tmp/x" }).hosted).toBe(false);
  });

  test("URL without key is a hard misconfiguration error", () => {
    expect(() => resolveClientFlip({ HASNA_DOMAINS_API_URL: "https://x.example" })).toThrow(
      /Misconfigured domains client/,
    );
  });

  test("key without URL is a hard misconfiguration error", () => {
    expect(() => resolveClientFlip({ HASNA_DOMAINS_API_KEY: "key" })).toThrow(
      /Misconfigured domains client/,
    );
  });
});

describe("the retired storage-mode env keys are not a selection mechanism", () => {
  test("a stale mode var does not change resolution in either direction", () => {
    // Without URL/key, a stale mode var must still resolve local.
    expect(getStore({ HASNA_DOMAINS_STORAGE_MODE: "cloud" })).toBeInstanceOf(LocalStore);
    // With URL/key, a stale mode var must still resolve hosted.
    const env = { ...HOSTED, HASNA_DOMAINS_STORAGE_MODE: "local" };
    expect((getStore({ ...env, NODE_ENV: "production" }) as unknown as { transport: string }).transport).toBe("cloud-http");
  });

  test("the retired keys are enumerated so the scrub is testable", () => {
    expect(RETIRED_MODE_KEYS).toContain("HASNA_DOMAINS_STORAGE_MODE");
    expect(RETIRED_MODE_KEYS).toContain("DOMAINS_STORAGE_MODE");
    expect(RETIRED_MODE_KEYS).toContain("HASNA_DOMAINS_MODE");
    expect(RETIRED_MODE_KEYS).toContain("DOMAINS_MODE");
  });
});
