import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiUnavailableError, getStore, resetStoreCache } from "./index.js";
import { resetDatabase } from "../db/database.js";

const tempHomes: string[] = [];

function freshLocalEnv(): Record<string, string | undefined> {
  const tempHome = mkdtempSync(join(tmpdir(), "contacts-store-home-"));
  tempHomes.push(tempHome);
  return {
    HOME: tempHome,
    HASNA_HOME: join(tempHome, ".hasna"),
    HASNA_STATION: "no-such-station",
    // Pin the local store to a file inside the temp home.
    CONTACTS_DB_PATH: join(tempHome, "data", "contacts.db"),
  };
}

const API_ENV = {
  HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
  HASNA_CONTACTS_API_KEY: "test-key-not-used-offline",
} as Record<string, string | undefined>;

afterEach(() => {
  resetStoreCache();
  resetDatabase();
  for (const tempHome of tempHomes.splice(0)) rmSync(tempHome, { recursive: true, force: true });
});

describe("getStore transport resolution", () => {
  it("selects the local SQLite store when no API configuration resolves", () => {
    expect(getStore(freshLocalEnv()).mode).toBe("local");
  });

  it("resolves only the hosted ApiStore when URL and key are present", () => {
    expect(getStore(API_ENV).mode).toBe("api");
  });

  it("ignores retired storage-mode and database selectors (they are inert)", () => {
    // A *MODE switch must never gate or redirect a transport: with an API
    // configuration it does nothing, with none the local store is used.
    expect(getStore({ ...API_ENV, HASNA_CONTACTS_STORAGE_MODE: "cloud" }).mode).toBe("api");
    resetStoreCache();
    expect(getStore({ ...API_ENV, CONTACTS_STORAGE_MODE: "self_hosted" }).mode).toBe("api");
    resetStoreCache();
    expect(getStore({ ...freshLocalEnv(), HASNA_CONTACTS_STORAGE_MODE: "cloud" }).mode).toBe("local");
    resetStoreCache();
    expect(getStore({ ...API_ENV, CONTACTS_DATABASE_URL: "postgresql://ignored" }).mode).toBe("api");
  });

  it("honors CONTACTS_DB_PATH for the local store", async () => {
    const env = freshLocalEnv();
    const store = getStore(env);
    expect(store.mode).toBe("local");
    const status = await store.storageStatus();
    expect(status).not.toBeNull();
    expect(status?.mode).toBe("local");
    expect(status?.db_path).toBe(env.CONTACTS_DB_PATH);
  });

  it("exercises the full local surface through the Store interface", async () => {
    const store = getStore(freshLocalEnv());
    const contact = await store.createContact({
      display_name: "Local Ada",
      first_name: "Ada",
      last_name: "Lovelace",
      emails: [{ address: "ada@example.com", type: "work" }],
    });
    expect(contact.display_name).toBe("Local Ada");
    expect(await store.getContact(contact.id)).toMatchObject({ display_name: "Local Ada" });
    expect((await store.listContacts()).total).toBe(1);
    const tag = await store.createTag({ name: "pilot" });
    await store.addTagToContact(contact.id, (tag as { id: string }).id);
    expect((await store.getContact(contact.id))?.tags?.some((t) => t.name === "pilot")).toBe(true);
    await store.updateContact(contact.id, { display_name: "Local Ada Updated" });
    expect((await store.getContact(contact.id))?.display_name).toBe("Local Ada Updated");
    const stats = await store.stats();
    expect(stats.contacts).toBe(1);
    await store.deleteContact(contact.id);
    expect((await store.listContacts()).total).toBe(0);
  });

  it("throws ApiUnavailableError for hosted-API operations that are not exposed", async () => {
    const store = getStore(API_ENV);
    await expect(store.semanticSearch("q", 5)).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(store.addDocument({} as never)).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(store.saveImage("c", "src")).rejects.toBeInstanceOf(ApiUnavailableError);
    await expect(store.unlockVault("pw")).rejects.toBeInstanceOf(ApiUnavailableError);
    // The hosted transport reports no on-box storage diagnostics.
    expect(await store.storageStatus()).toBeNull();
  });

  it("reports local storage diagnostics only in the local transport", async () => {
    const store = getStore(freshLocalEnv());
    const status = await store.storageStatus();
    expect(status).toMatchObject({ mode: "local" });
    expect(status?.tables.length).toBeGreaterThan(0);
    expect(status?.tables.some((t) => t.table === "contacts" && t.ok)).toBe(true);
  });
});