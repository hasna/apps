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
import { ApiStore, resolveStore } from "./store";
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
});describe("Canonical Store boundary", () => {
  test("local overrides are refused instead of generating on-box links", () => {
    expect(() => resolveStore({}, { forceLocal: true })).toThrow("retired");
  });
  test("custom base URL regeneration is forwarded to the service", async () => {
    let seen: unknown;
    const store = new ApiStore({ baseUrl: "https://example.test/v1", regenerateLink: async (_id, options) => { seen = options; return { link: INTERNAL_BASE + "/a/token", expires_at: null }; } } as AttachmentsV1Store);
    expect((await store.regenerateLink("att1", { baseUrl: INTERNAL_BASE, linkType: "server" })).link).toContain(INTERNAL_BASE);
    expect(seen).toEqual({ baseUrl: INTERNAL_BASE, linkType: "server" });
  });
});
