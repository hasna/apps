import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getStore, resetStoreCache, ApiUnavailableError } from "./index.js";
import { resetDatabase } from "../db/database.js";

const LOCAL_ENV = {} as Record<string, string | undefined>;
const API_ENV = {
  HASNA_CONTACTS_API_URL: "https://contacts.hasna.xyz",
  HASNA_CONTACTS_API_KEY: "test-key-not-used-offline",
} as Record<string, string | undefined>;

describe("getStore mode resolution", () => {
  const prevDbPath = process.env.HASNA_CONTACTS_DB_PATH;

  beforeEach(() => {
    process.env.HASNA_CONTACTS_DB_PATH = ":memory:";
    resetStoreCache();
    resetDatabase();
  });

  afterEach(() => {
    resetStoreCache();
    resetDatabase();
    if (prevDbPath === undefined) delete process.env.HASNA_CONTACTS_DB_PATH;
    else process.env.HASNA_CONTACTS_DB_PATH = prevDbPath;
  });

  it("resolves a LocalStore when no api env is set", () => {
    const store = getStore(LOCAL_ENV);
    expect(store.mode).toBe("local");
  });

  it("resolves an ApiStore when api url + key are present", () => {
    const store = getStore(API_ENV);
    expect(store.mode).toBe("api");
  });

  it("LocalStore performs a real contact CRUD roundtrip through the abstraction", async () => {
    const store = getStore(LOCAL_ENV);
    const created = await store.createContact({ display_name: "Ada Lovelace" });
    expect(created.id).toBeTruthy();

    const fetched = await store.getContact(created.id);
    expect(fetched?.display_name).toBe("Ada Lovelace");

    const updated = await store.updateContact(created.id, { display_name: "Ada L." });
    expect(updated.display_name).toBe("Ada L.");

    await store.deleteContact(created.id);
    // LocalStore.getContact throws ContactNotFoundError once the row is gone.
    await expect(store.getContact(created.id)).rejects.toThrow();
  });

  it("ApiStore throws ApiUnavailableError for ops that stay on-box (no silent local fallback)", async () => {
    const store = getStore(API_ENV);
    // Vault key material, encrypted documents/health, on-box images, and
    // embedding-backed semantic search are intentionally NOT exposed over /v1:
    // they must fail loudly, never write on-box SQLite while pointed at the cloud.
    await expect(store.semanticSearch("q", 5)).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(store.addDocument({} as never)).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(store.saveImage("c", "src")).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(store.unlockVault("pw")).rejects.toBeInstanceOf(ApiUnavailableError);
  });
});
