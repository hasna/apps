// Test-gap remediation: agent-authored (SOL consult refused — model at capacity).
// Covers src/core/store.ts, which had NO direct tests (everywhere else it is
// mock.module()'d): the env-driven store resolution, ApiStore delegation and
// its local-only option guards, and LocalStore.deleteExpired ordering.

import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ApiStore, LocalStore, resolveStore } from "./store";
import { normalizeConfig } from "./config";
import { resolveLocalObjectPath } from "./object-storage";
import { HASNA_ATTACHMENTS_DB_PATH_ENV } from "./paths";
import { AttachmentsDB, type Attachment } from "./db";
import type { AttachmentsV1Store } from "./cloud-v1";

const ORIGINAL_HOME = process.env.HOME;

const cloudEnv = {
  HASNA_ATTACHMENTS_API_URL: "https://attachments.hasna.xyz",
  HASNA_ATTACHMENTS_API_KEY: "hasna_attachments_testkey_0000",
} as NodeJS.ProcessEnv;

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "att_test001",
    filename: "photo.png",
    s3Key: "uploads/photo.png",
    bucket: "local",
    size: 1024,
    contentType: "image/png",
    link: null,
    tag: null,
    expiresAt: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeFakeV1(overrides: Partial<AttachmentsV1Store> = {}): AttachmentsV1Store {
  return {
    baseUrl: "https://attachments.hasna.xyz/v1",
    list: mock(async () => []),
    get: mock(async () => null),
    uploadBuffer: mock(async () => makeAttachment()),
    uploadFile: mock(async () => makeAttachment()),
    uploadStream: mock(async () => makeAttachment()),
    uploadUrl: mock(async () => makeAttachment()),
    delete: mock(async () => {}),
    getLink: mock(async () => ({ link: "https://x/a", expires_at: 111 })),
    isSlugAvailable: mock(async () => true),
    regenerateLink: mock(async () => ({ link: "https://x/b", expires_at: 222 })),
    download: mock(async () => ({ file: "/tmp/x", size: 3 })),
    saveFeedback: mock(async () => {}),
    presignUpload: mock(async () => ({
      id: "att_1",
      uploadUrl: "https://s3.example/put",
      contentType: "text/plain",
      filename: "a.txt",
      expiresAt: 111,
    })),
    presignComplete: mock(async () => ({ attachment: makeAttachment(), link: "https://x/c", size: 3 })),
    ...overrides,
  };
}

describe("resolveStore", () => {
  test("empty env resolves to a LocalStore", () => {
    const store = resolveStore({} as NodeJS.ProcessEnv);
    expect(store).toBeInstanceOf(LocalStore);
    expect(store.transport).toBe("local");
    expect(store.baseUrl).toBeNull();
    store.close();
  });

  test("URL+KEY env resolves to an ApiStore (cloud-http)", () => {
    const store = resolveStore(cloudEnv);
    expect(store).toBeInstanceOf(ApiStore);
    expect(store.transport).toBe("cloud-http");
    expect(store.baseUrl).toBe("https://attachments.hasna.xyz/v1");
  });

  test("forceLocal wins even when cloud env is present", () => {
    const store = resolveStore(cloudEnv, { forceLocal: true });
    expect(store).toBeInstanceOf(LocalStore);
    expect(store.transport).toBe("local");
    store.close();
  });
});

describe("ApiStore", () => {
  test("delegates reads/writes to the v1 store", async () => {
    const v1 = makeFakeV1();
    const store = new ApiStore(v1);
    expect(store.transport).toBe("cloud-http");

    await store.list({ limit: 2 });
    expect(v1.list).toHaveBeenCalledTimes(1);

    await store.uploadBuffer(Buffer.from("x"), "a.txt");
    expect(v1.uploadBuffer).toHaveBeenCalledTimes(1);

    await store.getLink("att_1");
    await store.regenerateLink("att_1", { expiry: "1h" });
    await store.presignUpload("a.txt", "text/plain", 60000);
    await store.presignComplete("att_1", { expiryMs: 60000, linkType: "server" });
    expect(v1.presignUpload).toHaveBeenCalledTimes(1);
    expect(v1.presignComplete).toHaveBeenCalledTimes(1);
  });

  test("forwards email-gated options to the v1 store", async () => {
    // Measured at origin/main: PR #400 made requireEmail/allowedEmails
    // supported on the hosted /v1 path — assertApiSupported is a no-op and
    // ApiStore forwards these options through toV1UploadOptions. No
    // client-side rejection exists any more.
    const v1 = makeFakeV1();
    const store = new ApiStore(v1);
    await store.uploadFile("/tmp/a.txt", { requireEmail: true, allowedEmails: ["a@b.c"] });
    expect(v1.uploadFile).toHaveBeenCalledTimes(1);
    const forwarded = (v1.uploadFile as ReturnType<typeof mock>).mock.calls[0]?.[1];
    expect(forwarded.requireEmail).toBe(true);
    expect(forwarded.allowedEmails).toEqual(["a@b.c"]);
  });

  test("forwards custom baseUrl options to the v1 store", async () => {
    // Same measured contract as above: baseUrl is honored on the hosted /v1
    // path and forwarded, for both upload verbs.
    const v1 = makeFakeV1();
    const store = new ApiStore(v1);
    await store.uploadFile("/tmp/a.txt", { baseUrl: "http://x:3459" });
    await store.uploadStream({} as NodeJS.ReadableStream, "a.txt", undefined, { baseUrl: "http://x" });
    expect(v1.uploadFile).toHaveBeenCalledTimes(1);
    expect(v1.uploadStream).toHaveBeenCalledTimes(1);
    expect((v1.uploadFile as ReturnType<typeof mock>).mock.calls[0]?.[1].baseUrl).toBe("http://x:3459");
    expect((v1.uploadStream as ReturnType<typeof mock>).mock.calls[0]?.[2].baseUrl).toBe("http://x");
  });

  test("deleteExpired removes only expired records the API still reports", async () => {
    const now = Date.now();
    const expired = makeAttachment({ id: "att_expired", expiresAt: now - 5000 });
    const live = makeAttachment({ id: "att_live", expiresAt: now + 60_000 });
    const deleted: string[] = [];
    const v1 = makeFakeV1({
      list: mock(async () => [expired, live]),
      delete: mock(async (id: string) => {
        deleted.push(id);
      }),
    });
    const store = new ApiStore(v1);
    const count = await store.deleteExpired();
    expect(count).toBe(1);
    expect(deleted).toEqual(["att_expired"]);
  });

  test("deleteExpired tolerates a delete failure on one record and keeps counting", async () => {
    const now = Date.now();
    const v1 = makeFakeV1({
      list: mock(async () => [
        makeAttachment({ id: "att_a", expiresAt: now - 1000 }),
        makeAttachment({ id: "att_b", expiresAt: now - 1000 }),
      ]),
      delete: mock(async (id: string) => {
        if (id === "att_a") throw new Error("upstream 500");
      }),
    });
    const store = new ApiStore(v1);
    await expect(store.deleteExpired()).resolves.toBe(2);
  });
});

describe("LocalStore.deleteExpired (bytes before record)", () => {
  let home: string;
  let localDir: string;
  let config: ReturnType<typeof normalizeConfig>;

  beforeEach(() => {
    home = join(tmpdir(), `attachments-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localDir = join(home, "objects");
    mkdirSync(localDir, { recursive: true });
    process.env.HOME = home;
    delete process.env[HASNA_ATTACHMENTS_DB_PATH_ENV];
    config = normalizeConfig({
      storage: { backend: "local", localDir, maxSizeBytes: 1_000_000 },
    });
  });

  afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIGINAL_HOME;
    delete process.env[HASNA_ATTACHMENTS_DB_PATH_ENV];
    rmSync(home, { recursive: true, force: true });
  });

  test("removes expired attachments (bytes and record) and leaves live ones intact", async () => {
    const now = Date.now();
    const expired = makeAttachment({ id: "att_expired", expiresAt: now - 1000, storageBackend: "local", s3Key: "expired.txt" });
    const live = makeAttachment({ id: "att_live", expiresAt: now + 60_000, storageBackend: "local", s3Key: "live.txt" });

    // Real DB rows + real object bytes for both. LocalStore and AttachmentsDB
    // resolve the same default path under the pinned HOME, so this handle is
    // the row store the LocalStore will read.
    const db = new AttachmentsDB();
    db.insert(expired);
    db.insert(live);
    db.close();
    writeFileSync(resolveLocalObjectPath(config, "expired.txt"), "gone");
    writeFileSync(resolveLocalObjectPath(config, "live.txt"), "kept");

    const store = new LocalStore(config);
    const count = await store.deleteExpired();
    expect(count).toBe(1);
    store.close();

    const verify = new AttachmentsDB();
    expect(verify.findById("att_expired")).toBeNull();
    expect(verify.findById("att_live")).not.toBeNull();
    verify.close();
    expect(existsSync(resolveLocalObjectPath(config, "expired.txt"))).toBe(false);
    expect(existsSync(resolveLocalObjectPath(config, "live.txt"))).toBe(true);
  });

  test("delete throws for a missing attachment id", async () => {
    const store = new LocalStore(config);
    await expect(store.delete("att_missing")).rejects.toThrow("Attachment not found: att_missing");
    store.close();
  });
});
