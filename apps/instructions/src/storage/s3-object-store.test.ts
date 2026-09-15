import { describe, expect, test } from "bun:test";
import type { InstructionsS3Config } from "./s3-config.js";
import {
  assertSafeInstructionsObjectKey,
  createInstructionsS3ObjectStore,
  memoryInstructionsObjectStore,
} from "./s3-object-store.js";

const CONFIG: InstructionsS3Config = {
  provider: "s3",
  bucket: "instructions-backups",
  prefix: "instructions/",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: "fixture-access",
    secretAccessKey: "fixture-secret",
    sessionToken: "fixture-session",
  },
};

describe("Instructions S3 object store", () => {
  test("constructs Bun's native client behind the injectable interface", async () => {
    const created: unknown[] = [];
    const written: Array<{ key: string; bytes: Uint8Array; type?: string }> = [];
    const objects = new Map<string, Uint8Array>();
    const store = createInstructionsS3ObjectStore(CONFIG, (options) => {
      created.push(options);
      return {
        async write(key, bytes, options) {
          const copy = Uint8Array.from(bytes);
          objects.set(key, copy);
          written.push({ key, bytes: copy, type: options?.type });
          return copy.byteLength;
        },
        file(key) {
          return {
            async exists() { return objects.has(key); },
            async bytes() { return objects.get(key) ?? new Uint8Array(); },
            async stat() { return { size: objects.get(key)?.byteLength ?? 0, etag: "fixture-etag", type: "application/octet-stream", lastModified: new Date(0) }; },
          };
        },
        async delete(key) { objects.delete(key); },
      };
    });

    await store.put("instructions/backups/a/payload", new TextEncoder().encode("hello"), { contentType: "text/plain" });
    expect(new TextDecoder().decode(await store.get("instructions/backups/a/payload"))).toBe("hello");
    expect(await store.head("instructions/backups/a/payload")).toMatchObject({ size: 5, etag: "fixture-etag" });
    await store.delete("instructions/backups/a/payload");
    expect(await store.get("instructions/backups/a/payload")).toBeUndefined();

    expect(created).toEqual([{
      bucket: CONFIG.bucket,
      region: CONFIG.region,
      accessKeyId: "fixture-access",
      secretAccessKey: "fixture-secret",
      sessionToken: "fixture-session",
      virtualHostedStyle: false,
    }]);
    expect(written[0]?.type).toBe("text/plain");
  });

  test("passes a validated custom endpoint without exposing configuration through results", () => {
    let options: Record<string, unknown> | undefined;
    createInstructionsS3ObjectStore({ ...CONFIG, endpoint: "http://localhost:9000" }, (value) => {
      options = value as Record<string, unknown>;
      return {
        async write() { return 0; },
        file() { return { async exists() { return false; }, async bytes() { return new Uint8Array(); }, async stat() { throw new Error("missing"); } }; },
        async delete() {},
      };
    });
    expect(options?.endpoint).toBe("http://localhost:9000");
    expect(options?.virtualHostedStyle).toBe(false);
  });

  test("validates every object key at the adapter boundary", async () => {
    const store = memoryInstructionsObjectStore();
    for (const key of ["", "/absolute", "a//b", "a/../b", "a\\b", "a\u0000b"]) {
      expect(() => assertSafeInstructionsObjectKey(key)).toThrow("object key");
      await expect(store.put(key, new Uint8Array(), { contentType: "application/octet-stream" })).rejects.toThrow("object key");
    }
  });

  test("the in-memory adapter owns byte copies", async () => {
    const store = memoryInstructionsObjectStore();
    const bytes = new Uint8Array([1, 2, 3]);
    await store.put("instructions/backups/a/payload", bytes, { contentType: "application/octet-stream" });
    bytes[0] = 9;
    const first = await store.get("instructions/backups/a/payload");
    expect(first).toEqual(new Uint8Array([1, 2, 3]));
    first![0] = 8;
    expect(await store.get("instructions/backups/a/payload")).toEqual(new Uint8Array([1, 2, 3]));
  });
});
