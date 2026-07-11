import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getStorageS3Config,
  getStorageS3Status,
  storageArtifactsUpload,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  parseStorageTables,
} from "./storage-sync";

const ENV_NAMES = [
  "HASNA_CRAWL_DATABASE_URL",
  "CRAWL_DATABASE_URL",
  "HASNA_CRAWL_STORAGE_MODE",
  "CRAWL_STORAGE_MODE",
  "HASNA_CRAWL_S3_BUCKET",
  "HASNA_CRAWL_S3_PREFIX",
  "HASNA_CRAWL_AWS_REGION",
  "HASNA_CRAWL_S3_ENDPOINT",
  "AWS_REGION",
  "S3_REGION",
  "AWS_ENDPOINT",
  "S3_ENDPOINT",
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

describe("crawl storage sync configuration", () => {
  beforeEach(() => {
    for (const name of ENV_NAMES) delete process.env[name];
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      const value = ORIGINAL_ENV.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("prefers canonical storage database envs", () => {
    process.env["CRAWL_DATABASE_URL"] = "postgres://fallback";
    process.env["HASNA_CRAWL_DATABASE_URL"] = "postgres://canonical";

    expect(getStorageDatabaseUrl()).toBe("postgres://canonical");
    expect(getStorageDatabaseEnv()).toEqual({
      name: "HASNA_CRAWL_DATABASE_URL",
      deprecated: false,
    });
  });

  it("uses the short crawl database env as a non-deprecated fallback", () => {
    process.env["CRAWL_DATABASE_URL"] = "postgres://fallback";

    expect(getStorageDatabaseUrl()).toBe("postgres://fallback");
    expect(getStorageDatabaseEnv()).toEqual({
      name: "CRAWL_DATABASE_URL",
      deprecated: false,
    });
  });

  it("derives local hybrid and explicit remote storage mode", () => {
    expect(getStorageMode()).toBe("local");

    process.env["CRAWL_DATABASE_URL"] = "postgres://remote";
    expect(getStorageMode()).toBe("hybrid");

    process.env["HASNA_CRAWL_STORAGE_MODE"] = "remote";
    expect(getStorageMode()).toBe("remote");
  });

  it("rejects non-storage mode names instead of accepting legacy cloud mode", () => {
    process.env["HASNA_CRAWL_STORAGE_MODE"] = "cloud";

    expect(() => getStorageMode()).toThrow("Unknown crawl storage mode");
  });

  it("reports canonical S3 artifact storage configuration", () => {
    process.env["HASNA_CRAWL_S3_BUCKET"] = "crawl-artifacts";
    process.env["HASNA_CRAWL_S3_PREFIX"] = "crawl/prod/";
    process.env["HASNA_CRAWL_AWS_REGION"] = "us-east-1";

    expect(getStorageS3Config()).toEqual({
      bucket: "crawl-artifacts",
      prefix: "crawl/prod",
      region: "us-east-1",
      endpoint: null,
    });
    expect(getStorageS3Status()).toMatchObject({
      configured: true,
      bucket: "crawl-artifacts",
      prefix: "crawl/prod",
      region: "us-east-1",
      env: {
        bucket: ["HASNA_CRAWL_S3_BUCKET"],
        prefix: ["HASNA_CRAWL_S3_PREFIX"],
      },
    });
  });

  it("fails artifact upload locally when no S3 bucket is configured", async () => {
    const result = await storageArtifactsUpload();

    expect(result).toMatchObject({
      direction: "upload",
      configured: false,
      bucket: null,
      errors: ["Missing HASNA_CRAWL_S3_BUCKET"],
    });
  });

  it("parses and validates storage table filters", () => {
    expect(parseStorageTables()).toContain("crawls");
    expect(parseStorageTables([" crawls ", "pages"])).toEqual(["crawls", "pages"]);
    expect(() => parseStorageTables(["missing"])).toThrow("Unknown crawl sync table");
  });

  it("exports database and artifact helpers from the storage subpath source", async () => {
    const storage = await import("../storage");

    expect(storage.STORAGE_TABLES).toContain("crawls");
    expect(storage.getStorageDatabaseUrl()).toBeNull();
    expect(storage.getStorageMode()).toBe("local");
    expect(storage.getStorageS3Status().configured).toBe(false);
    expect(storage.PG_MIGRATIONS.length).toBeGreaterThan(0);
    expect(typeof storage.PgAdapterAsync).toBe("function");
  });
});
