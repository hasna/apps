import { describe, expect, test } from "bun:test";
import { getStore, getStoreResolution, isCloudStore, LocalStore } from "./store.js";

// -- Store selection through the ONE shared resolver --------------------------
//
// The client selects its backend through the @hasna/contracts 1.0.2 resolver
// (see ../lib/domains-resolver.ts): URL + key (env, Keychain, disk) -> hosted
// HTTP client; a key ALONE defaults to the fleet gateway; nothing resolvable
// -> FAIL CLOSED unless local sqlite is explicitly opted into with a local
// path var (HASNA_DOMAINS_DB_PATH / HASNA_DOMAINS_DIR and their legacy
// unprefixed aliases). The retired storage-mode env keys are stripped from
// the package entirely and never select anything (hasna/apps#1720, class B).

const HOSTED = {
  HASNA_DOMAINS_API_URL: "https://domains.example.invalid",
  HASNA_DOMAINS_API_KEY: "not-a-real-key-fixture-only",
};

describe("store resolution through the @hasna/contracts resolver", () => {
  test("URL + key resolves the hosted HTTP store and reports its sources", () => {
    expect((getStore(HOSTED) as unknown as { transport: string }).transport).toBe("http");
    const res = getStoreResolution(HOSTED);
    expect(res.transport).toBe("http");
    expect(res.apiUrlSource).toBe("HASNA_DOMAINS_API_URL");
    expect(res.apiKeySource).toBe("HASNA_DOMAINS_API_KEY");
    expect(res.apiKeyTier).toBe("env");
    expect(res.localPathVar).toBeNull();
  });

  test("a key ALONE resolves the fleet gateway default authority", () => {
    const res = getStoreResolution({ HASNA_DOMAINS_API_KEY: "fixture-key" });
    expect(res.transport).toBe("http");
    expect(res.apiUrlSource).toBe("default");
    expect(res.baseUrl).toBe("https://api.hasna.com/domains/v1");
    expect(res.apiKeySource).toBe("HASNA_DOMAINS_API_KEY");
  });

  test("the unprefixed DOMAINS_API_URL + DOMAINS_API_KEY aliases are the resolver's silent alias only", () => {
    // The app never reads the unprefixed names itself; the shared resolver's
    // silent-alias fallback is the only place they are accepted, one release.
    const res = getStoreResolution({ DOMAINS_API_URL: "https://api.example", DOMAINS_API_KEY: "key" });
    expect(res.transport).toBe("http");
    expect(res.apiUrlSource).toBe("DOMAINS_API_URL");
  });

  test("a URL without a key fails closed, naming the key env var", () => {
    expect(() => getStore({ HASNA_DOMAINS_API_URL: "https://x.example" })).toThrow(/fails closed/);
    expect(() => getStore({ HASNA_DOMAINS_API_URL: "https://x.example" })).toThrow(/HASNA_DOMAINS_API_KEY/);
  });

  test("nothing configured fails closed and never opens the default local db", () => {
    expect(() => getStore({})).toThrow(/fails closed/);
    expect(() => getStore({})).toThrow(/HASNA_DOMAINS_API_URL/);
    expect(() => getStore({})).toThrow(/HASNA_DOMAINS_API_KEY/);
    expect(() => isCloudStore({})).toThrow(/fails closed/);
  });

  test("an explicit local path opt-in still resolves a LocalStore — and only it does", () => {
    expect(getStore({ DOMAINS_DB_PATH: "/tmp/scratch.db" })).toBeInstanceOf(LocalStore);
    expect(getStore({ HASNA_DOMAINS_DIR: "/tmp/domains" })).toBeInstanceOf(LocalStore);
    expect(isCloudStore({ DOMAINS_DB_PATH: "/tmp/scratch.db" })).toBe(false);
    expect(getStoreResolution({ HASNA_DOMAINS_DB_PATH: "/tmp/d.db" }).transport).toBe("local");
  });

  test("a local path set NEXT TO a configured credential is a hard conflict", () => {
    expect(() => getStore({ ...HOSTED, DOMAINS_DB_PATH: "/tmp/scratch.db" })).toThrow(
      /Refusing to resolve the hosted domains store while DOMAINS_DB_PATH is set/,
    );
    expect(() => getStore({ HASNA_DOMAINS_API_KEY: "key", HASNA_DOMAINS_DIR: "/tmp/d" })).toThrow(/fails|Refusing/);
  });
});

describe("the retired storage-mode env keys are gone from the package", () => {
  test("a stale mode var does not change resolution in either direction", () => {
    // Without URL/key AND without a local opt-in, a stale mode var must not
    // smuggle the client into a backend at all — resolution fails closed.
    expect(() => getStore({ HASNA_DOMAINS_STORAGE_MODE: "cloud" })).toThrow(/fails closed/);
    // A stale mode var cannot veto an explicit local path opt-in either.
    expect(
      getStore({ HASNA_DOMAINS_STORAGE_MODE: "cloud", DOMAINS_DB_PATH: "/tmp/scratch.db" }),
    ).toBeInstanceOf(LocalStore);
    // With URL/key, a stale mode var must still resolve hosted.
    const env = { ...HOSTED, HASNA_DOMAINS_STORAGE_MODE: "local" };
    expect((getStore(env) as unknown as { transport: string }).transport).toBe("http");
  });

  test("the app source never enumerates a mode or storage-mode key", async () => {
    // Strip, not retire: no app code mentions the switches at all, so a stale
    // operator env cannot even match a string here.
    const source = await Bun.file(new URL("./store.ts", import.meta.url)).text();
    expect(source).not.toMatch(/DOMAINS_(?:STORAGE_)?MODE|HASNA_DOMAINS_(?:STORAGE_)?MODE/);
  });
});