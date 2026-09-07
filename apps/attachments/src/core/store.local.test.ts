/**
 * Hermetic tests for the ON-BOX transport: the explicit local opt-in, the
 * store selection rules (local is never a fallback), and a full
 * LocalStore round trip against a scratch SQLite database and object dir.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { LocalStore, ApiStore, resolveStore } from "./store";
import { normalizeConfig, type AttachmentsConfig } from "./config";
import { AttachmentsDB } from "./db";
import {
  __resetAttachmentsLocalModeNotice,
  announceAttachmentsLocalMode,
  hasExplicitLocalDbPath,
  isAttachmentsLocalOptIn,
  selectsAttachmentsLocalStore,
  REMOVED_ATTACHMENTS_MODE_ENV_KEYS,
} from "./local-opt-in";

let scratch: string;
let previousDbPath: string | undefined;

function localConfig(overrides?: Partial<AttachmentsConfig["storage"]> & { linkType?: "presigned" | "server" }): AttachmentsConfig {
  return normalizeConfig({
    storage: {
      backend: "local",
      localDir: join(scratch, "objects"),
      maxSizeBytes: 10 * 1024 * 1024,
      ...overrides,
    },
    server: { baseUrl: "http://localhost:3459", publicPath: "/a" },
    defaults: { expiry: "7d", linkType: overrides?.linkType ?? "server" },
  });
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "attachments-localstore-"));
  previousDbPath = process.env.HASNA_ATTACHMENTS_DB_PATH;
  process.env.HASNA_ATTACHMENTS_DB_PATH = join(scratch, "db.sqlite");
  __resetAttachmentsLocalModeNotice();
});

afterEach(() => {
  if (previousDbPath === undefined) delete process.env.HASNA_ATTACHMENTS_DB_PATH;
  else process.env.HASNA_ATTACHMENTS_DB_PATH = previousDbPath;
  rmSync(scratch, { recursive: true, force: true });
  __resetAttachmentsLocalModeNotice();
});

describe("local opt-in selection (local is deliberate, never a fallback)", () => {
  test("the flag opt-in and an explicit DB path are both recognized", () => {
    expect(isAttachmentsLocalOptIn({ HASNA_ATTACHMENTS_LOCAL: "1" })).toBe(true);
    expect(isAttachmentsLocalOptIn({ ATTACHMENTS_LOCAL: "1" })).toBe(true);
    expect(isAttachmentsLocalOptIn({ HASNA_ATTACHMENTS_LOCAL: "" })).toBe(false);
    expect(isAttachmentsLocalOptIn({})).toBe(false);
    expect(hasExplicitLocalDbPath({ HASNA_ATTACHMENTS_DB_PATH: "/tmp/x.db" })).toBe(true);
    expect(hasExplicitLocalDbPath({ ATTACHMENTS_DB_PATH: "/tmp/x.db" })).toBe(true);
    expect(hasExplicitLocalDbPath({})).toBe(false);
  });

  test("an explicit DB path is precedence-1 — it wins even over a full API configuration", () => {
    expect(
      selectsAttachmentsLocalStore({
        HASNA_ATTACHMENTS_DB_PATH: "/tmp/x.db",
        HASNA_ATTACHMENTS_API_URL: "https://api.example.test",
        HASNA_ATTACHMENTS_API_KEY: "key",
      }),
    ).toBe(true);
  });

  test("the flag opt-in loses to any configured authority and is inert otherwise", () => {
    // A configured credential anywhere in the chain outranks the flag: the run
    // goes hosted (and a half one fails loudly) rather than serving a
    // different dataset because a stale flag was lying around.
    expect(
      selectsAttachmentsLocalStore({ HASNA_ATTACHMENTS_LOCAL: "1", HASNA_ATTACHMENTS_API_KEY: "key" }),
    ).toBe(false);
    expect(selectsAttachmentsLocalStore({ HASNA_ATTACHMENTS_LOCAL: "1" })).toBe(true);
    expect(selectsAttachmentsLocalStore({ ATTACHMENTS_LOCAL: "1" })).toBe(true);
    expect(selectsAttachmentsLocalStore({})).toBe(false);
  });

  test("retired mode words select nothing — local or hosted", () => {
    for (const key of REMOVED_ATTACHMENTS_MODE_ENV_KEYS) {
      expect(selectsAttachmentsLocalStore({ [key]: "local" })).toBe(false);
      expect(selectsAttachmentsLocalStore({ [key]: "cloud" })).toBe(false);
    }
    // The flag still selects local even when a retired mode word lies around.
    expect(
      selectsAttachmentsLocalStore({ HASNA_ATTACHMENTS_LOCAL: "1", HASNA_ATTACHMENTS_MODE: "cloud" }),
    ).toBe(true);
  });

  test("an empty or half-configured environment never falls back to local", () => {
    expect(() => resolveStore({})).toThrow();
    expect(() => resolveStore({ HASNA_ATTACHMENTS_API_URL: "https://api.example.test" })).toThrow();
    expect(() => resolveStore({ HASNA_ATTACHMENTS_STORAGE_MODE: "local" })).toThrow();
  });
});

describe("resolveStore transport decision", () => {
  test("the flag opt-in returns the on-box store; hosted env returns ApiStore", async () => {
    const local = resolveStore({ HASNA_ATTACHMENTS_LOCAL: "1" });
    expect(local).toBeInstanceOf(LocalStore);
    expect(local.transport).toBe("local");
    expect(local.baseUrl).toBeNull();
    local.close();

    const hosted = resolveStore(
      {
        HASNA_ATTACHMENTS_API_URL: "https://api.example.test",
        HASNA_ATTACHMENTS_API_KEY: "key",
      },
      {},
    );
    // resolveAttachmentsV1 needs a fetch; the constructor resolves the URL
    // without a request, and the store type is decided by env alone.
    expect(hosted).toBeInstanceOf(ApiStore);
    expect(hosted.transport).toBe("cloud-http");
    hosted.close();
  });

  test("forceLocal selects the on-box store even with a full API configuration", () => {
    const store = resolveStore(
      { HASNA_ATTACHMENTS_API_URL: "https://api.example.test", HASNA_ATTACHMENTS_API_KEY: "key" },
      { forceLocal: true },
    );
    expect(store.transport).toBe("local");
    store.close();
  });
});

describe("LocalStore round trip (upload → list → download → link → delete)", () => {
  test("uploads to the local object store, lists, downloads, relinks and deletes", async () => {
    const store = new LocalStore(localConfig());
    const fileName = "roundtrip.txt";
    const body = Buffer.from("local transport round trip\n");

    const uploaded = await store.uploadBuffer(body, fileName, { expiry: "30m" });
    expect(uploaded.filename).toBe(fileName);
    expect(uploaded.storageBackend).toBe("local");
    expect(uploaded.bucket).toBe("local");
    expect(uploaded.link).toMatch(/^http:\/\/localhost:3459\/a\//);
    // Object bytes landed under the local object dir at the canonical key.
    const objectPath = join(scratch, "objects", uploaded.s3Key);
    expect(existsSync(objectPath)).toBe(true);
    expect(readFileSync(objectPath, "utf8")).toBe(body.toString());

    const listed = await store.list();
    expect(listed.some((a) => a.id === uploaded.id)).toBe(true);
    expect((await store.get(uploaded.id))?.size).toBe(body.length);

    const download = await store.download(uploaded.id, join(scratch, "out"));
    expect(readFileSync(download.path, "utf8")).toBe(body.toString());

    const regenerated = await store.regenerateLink(uploaded.id, {
      expiry: "7d",
      linkType: "server",
      baseUrl: "http://attachments.tail.test:3459",
    });
    expect(regenerated.link).toMatch(/^http:\/\/attachments\.tail\.test:3459\/a\//);
    expect(regenerated.expires_at).not.toBeNull();

    await store.delete(uploaded.id);
    expect(await store.get(uploaded.id)).toBeNull();
    expect(existsSync(objectPath)).toBe(false);
    store.close();
  });

  test("friendly slug availability is tracked on the on-box share_links table", async () => {
    const store = new LocalStore(localConfig());
    expect(await store.isSlugAvailable("my-nice-slug")).toBe(true);
    const uploaded = await store.uploadBuffer(Buffer.from("slug"), "slug.txt");
    const regenerated = await store.regenerateLink(uploaded.id, {
      expiry: "7d",
      linkType: "server",
      slug: "my-nice-slug",
      password: "pw",
    });
    expect(regenerated.slug).toBe("my-nice-slug");
    expect(await store.isSlugAvailable("my-nice-slug")).toBe(false);
    store.close();
  });

  test("deleteExpired removes expired attachments and their bytes", async () => {
    const store = new LocalStore(localConfig());
    const db = new AttachmentsDB();
    const now = Date.now();
    db.insert({
      id: "att_expired_1",
      filename: "old.txt",
      s3Key: "expired/key",
      bucket: "local",
      size: 4,
      contentType: "text/plain",
      link: null,
      tag: null,
      expiresAt: now - 1000,
      createdAt: now - 100000,
      storageBackend: "local",
      status: "ready",
    });
    db.insert({
      id: "att_live_1",
      filename: "live.txt",
      s3Key: "live/key",
      bucket: "local",
      size: 4,
      contentType: "text/plain",
      link: null,
      tag: null,
      expiresAt: now + 60_000,
      createdAt: now,
      storageBackend: "local",
      status: "ready",
    });
    db.close();

    expect(await store.deleteExpired()).toBe(1);
    expect(await store.get("att_expired_1")).toBeNull();
    expect(await store.get("att_live_1")).not.toBeNull();
    store.close();
  });

  test("saveFeedback writes an on-box feedback row", async () => {
    const store = new LocalStore(localConfig());
    await store.saveFeedback({ message: "local hello", email: null, category: "general", version: null });
    store.close();
    const { Database } = await import("bun:sqlite");
    const db = new Database(join(scratch, "db.sqlite"), { readonly: true });
    const row = db.query("SELECT count(*) AS n FROM feedback").get() as { n: number };
    db.close();
    expect(Number(row.n)).toBe(1);
  });

  test("presign upload in local mode is config-gated, not transport-gated", async () => {
    const store = new LocalStore(localConfig());
    await expect(store.presignUpload("direct.bin", "application/octet-stream", 60_000)).rejects.toThrow(
      /S3 configuration incomplete/,
    );
    store.close();
  });
});

describe("local-mode announcement", () => {
  test("prints exactly once per process when the store is selected", () => {
    const lines: string[] = [];
    const stderr = (line: string) => lines.push(line);
    announceAttachmentsLocalMode({ HASNA_ATTACHMENTS_LOCAL: "1" }, stderr);
    announceAttachmentsLocalMode({ HASNA_ATTACHMENTS_LOCAL: "1" }, stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("LOCAL mode");
    expect(lines[0]).toContain("HASNA_ATTACHMENTS_LOCAL");
  });

  test("is silent when no local store is selected", () => {
    const lines: string[] = [];
    announceAttachmentsLocalMode({}, (line) => lines.push(line));
    announceAttachmentsLocalMode(
      { HASNA_ATTACHMENTS_API_URL: "https://x.test", HASNA_ATTACHMENTS_API_KEY: "k" },
      (line) => lines.push(line),
    );
    expect(lines).toHaveLength(0);
  });
});