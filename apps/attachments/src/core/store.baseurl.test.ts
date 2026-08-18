/**
 * Custom base URL server links (CLI `--internal` / `options.baseUrl`) across
 * both store transports.
 *
 * Before the fix, `assertApiSupported` rejected `options.baseUrl` on the
 * hosted/cloud path with "--internal / custom base URL links are only
 * available in local mode", and the local `regenerateLink` path ignored the
 * option. These tests lock the ported behavior: both transports accept the
 * option and both verbs honor it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ApiStore, LocalStore } from "./store";
import type { AttachmentsV1Store, V1UploadOptions } from "./cloud-v1";

const INTERNAL_BASE = "http://attachments.internal.tailnet.local:3459";

describe("ApiStore — custom base URL upload option on the hosted path", () => {
  test("uploadBuffer with baseUrl is NOT rejected and passes the option through", async () => {
    let seen: V1UploadOptions | undefined;
    const v1 = {
      baseUrl: "https://api.example/v1",
      uploadBuffer: async (_filename: string, _bytes: Uint8Array, options?: V1UploadOptions) => {
        seen = options;
        return {
          id: "att_1",
          filename: "a.txt",
          s3Key: "",
          bucket: "cloud",
          size: 1,
          contentType: "text/plain",
          link: `${INTERNAL_BASE}/a/tok`,
          tag: null,
          expiresAt: null,
          createdAt: 0,
          storageBackend: "s3",
          status: "ready",
        };
      },
    } as unknown as AttachmentsV1Store;

    const store = new ApiStore(v1);
    const att = await store.uploadBuffer(Buffer.from("x"), "a.txt", { baseUrl: INTERNAL_BASE });
    expect(att.link).toBe(`${INTERNAL_BASE}/a/tok`);
    expect(seen).toMatchObject({ baseUrl: INTERNAL_BASE });
  });
});

describe("LocalStore — regenerateLink honors a custom baseUrl (parity with the hosted path)", () => {
  const dir = mkdtempSync(join(tmpdir(), "attachments-baseurl-test-"));
  const dbPath = join(dir, "metadata.sqlite");
  const prevDbPath = process.env["HASNA_ATTACHMENTS_DB_PATH"];

  afterAll(() => {
    if (prevDbPath === undefined) delete process.env["HASNA_ATTACHMENTS_DB_PATH"];
    else process.env["HASNA_ATTACHMENTS_DB_PATH"] = prevDbPath;
    rmSync(dir, { recursive: true, force: true });
  });

  test("a regenerated server link points at the requested base URL", async () => {
    process.env["HASNA_ATTACHMENTS_DB_PATH"] = dbPath;
    const store = new LocalStore({
      s3: { bucket: "", region: "", accessKeyId: "", secretAccessKey: "" },
      storage: { backend: "local", localDir: join(dir, "objects"), maxSizeBytes: 1024 * 1024 },
      server: { port: 3459, host: "localhost", baseUrl: "http://localhost:3459", publicPath: "/a" },
      defaults: { expiry: "7d", linkType: "presigned" },
      client: { preferInternal: false },
      domains: [],
      deployment: {},
    });
    try {
      const att = await store.uploadBuffer(Buffer.from("hello"), "note.txt", { linkType: "server" });
      expect(att.link).toContain("localhost:3459");
      const result = await store.regenerateLink(att.id, { baseUrl: INTERNAL_BASE, linkType: "server" });
      expect(result.link?.startsWith(`${INTERNAL_BASE}/a/`)).toBe(true);
      expect(result.link).not.toContain("localhost:3459");
    } finally {
      store.close();
    }
  });
});
