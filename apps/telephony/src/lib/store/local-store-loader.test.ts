import { describe, expect, it } from "bun:test";
import { loadLocalStore, resetLocalStoreModule } from "./local-store-loader.js";

/**
 * The gated door to the on-box SQLite store.
 *
 * `./local-store.ts` is the only module in the client graph that reaches
 * `bun:sqlite`, and `./local-store-loader.ts` is the only thing that imports
 * it. These cases pin the gate itself: the module must not even be IMPORTED
 * unless the explicit opt-in really selected local mode, because a hosted
 * process that can load the store is one bad branch away from serving on-box
 * data to somebody who believes they are on the fleet.
 *
 * Every case passes a CALLER-BUILT env object, which the @hasna/contracts
 * resolver treats as a world without ambient tiers (no Keychain, no disk), so
 * they run identically on a station that holds the real telephony credential
 * and on a bare CI runner.
 */

const HOSTED_ENV = {
  HASNA_TELEPHONY_API_URL: "https://telephony.invalid",
  HASNA_TELEPHONY_API_KEY: "test-only-not-a-real-key",
} as const;

describe("the gated door to the on-box SQLite store", () => {
  it("refuses to import the store under a resolved credential", async () => {
    resetLocalStoreModule();
    await expect(loadLocalStore({ ...HOSTED_ENV })).rejects.toThrow(
      /Refusing to open the on-box SQLite store/,
    );
  });

  it("refuses — with the shared fail-closed error — when nothing is configured", async () => {
    resetLocalStoreModule();
    // Not the loader's own refusal: the resolver's actionable error, naming
    // the Keychain item, the credentials file, the env variable and the opt-in.
    await expect(loadLocalStore({})).rejects.toThrow(/fails closed/);
    resetLocalStoreModule();
    await expect(loadLocalStore({})).rejects.toThrow(/hasna\.credentials\.telephony\.api-key/);
    resetLocalStoreModule();
    await expect(loadLocalStore({})).rejects.toThrow(/HASNA_TELEPHONY_LOCAL=1/);
  });

  it("opens under the explicit opt-in, and hands back the local transport", async () => {
    resetLocalStoreModule();
    const store = await loadLocalStore({ HASNA_TELEPHONY_LOCAL: "1" });
    expect(store.transport).toBe("local");
    // Loading the module opens no database file — the handle is lazy — so
    // resolving the store never creates ~/.hasna/telephony/telephony.db.
  });

  it("opens under the documented alias too", async () => {
    resetLocalStoreModule();
    expect((await loadLocalStore({ TELEPHONY_LOCAL: "1" })).transport).toBe("local");
  });

  it("still yields to a credential even when the opt-in is set", async () => {
    // The opt-in is a gate, not a selector: a configured environment outranks it.
    resetLocalStoreModule();
    await expect(loadLocalStore({ ...HOSTED_ENV, HASNA_TELEPHONY_LOCAL: "1" })).rejects.toThrow(
      /Refusing to open the on-box SQLite store/,
    );
  });
});
