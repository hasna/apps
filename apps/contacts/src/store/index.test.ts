import { afterEach, describe, expect, it } from "bun:test";
import { ApiUnavailableError, getStore, resetStoreCache } from "./index.js";
import { ContactsClientConfigurationError } from "../cloud/http-storage.js";

const API_ENV = {
  HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
  HASNA_CONTACTS_API_KEY: "test-key-not-used-offline",
} as Record<string, string | undefined>;

afterEach(() => resetStoreCache());

describe("getStore canonical client resolution", () => {
  it("fails closed when no API URL or credential can be resolved", () => {
    expect(() => getStore({})).toThrow(ContactsClientConfigurationError);
    expect(() => getStore({})).toThrow(/CONTACTS_API_NOT_CONFIGURED/);
  });

  it("resolves only the HTTPS ApiStore when URL and key are present", () => {
    expect(getStore(API_ENV).mode).toBe("api");
  });

  it("rejects retired local and database selectors", () => {
    expect(() => getStore({ ...API_ENV, CONTACTS_DB_PATH: "/tmp/contacts.db" })).toThrow(
      /RETIRED_CONTACTS_CLIENT_SELECTOR/,
    );
    expect(() => getStore({ ...API_ENV, HASNA_CONTACTS_STORAGE_MODE: "cloud" })).toThrow(
      /RETIRED_CONTACTS_CLIENT_SELECTOR/,
    );
    expect(() => getStore({ ...API_ENV, HASNA_CONTACTS_DATABASE_URL: "postgresql:\/\/client-forbidden" })).toThrow(
      /RETIRED_CONTACTS_CLIENT_SELECTOR/,
    );
  });

  it("throws for API operations that are not exposed instead of using local data", async () => {
    const store = getStore(API_ENV);
    await expect(store.semanticSearch("q", 5)).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(store.addDocument({} as never)).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(store.saveImage("c", "src")).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(store.unlockVault("pw")).rejects.toBeInstanceOf(ApiUnavailableError);
  });
});
