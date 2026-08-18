import { describe, expect, test } from "bun:test";
import {
  normalizeSessionObjectPrefix,
  prefixSessionObjectKey,
  resolveSessionObjectStoreConfig,
} from "./object-store-config.js";

describe("resolveSessionObjectStoreConfig", () => {
  test("returns null when object storage is not configured", () => {
    expect(resolveSessionObjectStoreConfig({})).toBeNull();
  });

  test("resolves named sessions environment fields and normalizes the prefix", () => {
    expect(
      resolveSessionObjectStoreConfig({
        HASNA_SESSIONS_S3_BUCKET: "fixture-sessions",
        HASNA_SESSIONS_S3_REGION: "fixture-region-1",
        HASNA_SESSIONS_S3_ENDPOINT: "https://objects.invalid",
        HASNA_SESSIONS_S3_PREFIX: "/session-objects/",
      }),
    ).toEqual({
      bucket: "fixture-sessions",
      region: "fixture-region-1",
      endpoint: "https://objects.invalid",
      prefix: "session-objects",
    });
  });

  test("requires explicit credential fields to be configured as a pair", () => {
    expect(() =>
      resolveSessionObjectStoreConfig({
        HASNA_SESSIONS_S3_BUCKET: "fixture-sessions",
        HASNA_SESSIONS_S3_ACCESS_KEY_ID: "fixture-only-id",
      }),
    ).toThrow(
      "HASNA_SESSIONS_S3_ACCESS_KEY_ID and HASNA_SESSIONS_S3_SECRET_ACCESS_KEY",
    );
  });

  test("joins normalized prefixes without changing the object key", () => {
    expect(normalizeSessionObjectPrefix(" //archive/// ")).toBe("archive");
    expect(prefixSessionObjectKey("archive", "machine=m/session=s/object=d.json")).toBe(
      "archive/machine=m/session=s/object=d.json",
    );
    expect(prefixSessionObjectKey("", "machine=m/session=s/object=d.json")).toBe(
      "machine=m/session=s/object=d.json",
    );
  });
});
