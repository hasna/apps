import { beforeEach, describe, expect, test } from "bun:test";
import { getStore, resetStoreCache } from "./index.js";
import { LocalStore } from "./local.js";
import { ApiStore } from "./api.js";

const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  SAVED.HASNA_CALENDAR_API_URL = process.env.HASNA_CALENDAR_API_URL;
  SAVED.HASNA_CALENDAR_API_KEY = process.env.HASNA_CALENDAR_API_KEY;
  SAVED.CALENDAR_API_URL = process.env.CALENDAR_API_URL;
  SAVED.CALENDAR_API_KEY = process.env.CALENDAR_API_KEY;
  resetStoreCache();
});

function restore() {
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetStoreCache();
}

describe("getStore transport selection", () => {
  test("with no client env the store is the local SQLite transport", () => {
    delete process.env.HASNA_CALENDAR_API_URL;
    delete process.env.HASNA_CALENDAR_API_KEY;
    const store = getStore({});
    expect(store).toBeInstanceOf(LocalStore);
    expect(store.transport).toBe("local");
    restore();
  });

  test("with the API pair set the store is the hosted ApiStore", () => {
    const store = getStore({
      HASNA_CALENDAR_API_URL: "https://calendar.hasna.xyz",
      HASNA_CALENDAR_API_KEY: "k",
    });
    expect(store).toBeInstanceOf(ApiStore);
    expect(store.transport).toBe("api");
    restore();
  });

  test("with only one of the pair set, resolution FAILS CLOSED", () => {
    expect(() => getStore({ HASNA_CALENDAR_API_URL: "https://calendar.hasna.xyz" })).toThrow();
    expect(() => getStore({ HASNA_CALENDAR_API_KEY: "k" })).toThrow();
    restore();
  });

  test("getStore memoizes the resolved store per process", () => {
    delete process.env.HASNA_CALENDAR_API_URL;
    delete process.env.HASNA_CALENDAR_API_KEY;
    const first = getStore({});
    const second = getStore({});
    expect(first).toBe(second);
    restore();
  });

  test("resetStoreCache drops the memoized instance", () => {
    delete process.env.HASNA_CALENDAR_API_URL;
    delete process.env.HASNA_CALENDAR_API_KEY;
    const first = getStore({});
    resetStoreCache();
    const second = getStore({});
    expect(second).not.toBe(first);
    restore();
  });
});
