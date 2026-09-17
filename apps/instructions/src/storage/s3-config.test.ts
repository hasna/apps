import { describe, expect, test } from "bun:test";
import {
  INSTRUCTIONS_S3_ENV,
  loadInstructionsS3Config,
  normalizeInstructionsS3Prefix,
} from "./s3-config.js";

describe("Instructions S3 configuration", () => {
  test("is disabled when no bucket is configured", () => {
    expect(loadInstructionsS3Config({})).toBeUndefined();
  });

  test("loads canonical configuration and normalizes its prefix", () => {
    expect(loadInstructionsS3Config({
      HASNA_INSTRUCTIONS_S3_BUCKET: "instructions-backups",
      HASNA_INSTRUCTIONS_S3_PREFIX: "/customer-a/instructions/",
      HASNA_INSTRUCTIONS_AWS_REGION: "us-west-2",
      HASNA_INSTRUCTIONS_S3_ENDPOINT: "https://objects.example.test",
      HASNA_INSTRUCTIONS_S3_FORCE_PATH_STYLE: "true",
      HASNA_INSTRUCTIONS_S3_ACCESS_KEY_ID: "fixture-access",
      HASNA_INSTRUCTIONS_S3_SECRET_ACCESS_KEY: "fixture-secret",
      HASNA_INSTRUCTIONS_S3_SESSION_TOKEN: "fixture-session",
    })).toEqual({
      provider: "s3",
      bucket: "instructions-backups",
      prefix: "customer-a/instructions/",
      region: "us-west-2",
      endpoint: "https://objects.example.test",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "fixture-access",
        secretAccessKey: "fixture-secret",
        sessionToken: "fixture-session",
      },
    });
  });

  test("supports aliases while canonical values take precedence", () => {
    expect(loadInstructionsS3Config({
      INSTRUCTIONS_S3_BUCKET: "alias-bucket",
      INSTRUCTIONS_S3_PREFIX: "alias/",
      INSTRUCTIONS_AWS_REGION: "eu-west-1",
      HASNA_INSTRUCTIONS_S3_BUCKET: "canonical-bucket",
      HASNA_INSTRUCTIONS_S3_PREFIX: "canonical/",
    })).toMatchObject({
      bucket: "canonical-bucket",
      prefix: "canonical/",
      region: "eu-west-1",
    });
  });

  test("a deliberately blank canonical bucket does not revive a stale alias", () => {
    expect(loadInstructionsS3Config({
      HASNA_INSTRUCTIONS_S3_BUCKET: " ",
      INSTRUCTIONS_S3_BUCKET: "stale-alias",
    })).toBeUndefined();
  });

  test("rejects orphaned S3 settings without a bucket", () => {
    expect(() => loadInstructionsS3Config({
      HASNA_INSTRUCTIONS_S3_ENDPOINT: "https://objects.example.test",
    })).toThrow(`${INSTRUCTIONS_S3_ENV.bucket} is required`);
  });

  test("rejects partial static credentials and orphaned session tokens", () => {
    expect(() => loadInstructionsS3Config({
      HASNA_INSTRUCTIONS_S3_BUCKET: "valid-bucket",
      HASNA_INSTRUCTIONS_S3_ACCESS_KEY_ID: "only-one-half",
    })).toThrow("must be configured together");

    expect(() => loadInstructionsS3Config({
      HASNA_INSTRUCTIONS_S3_BUCKET: "valid-bucket",
      HASNA_INSTRUCTIONS_S3_SESSION_TOKEN: "orphaned-token",
    })).toThrow("requires a complete static credential pair");
  });

  test("rejects unsafe endpoints", () => {
    for (const endpoint of [
      "ftp://objects.example.test",
      "https://user:password@objects.example.test",
      "https://objects.example.test/path",
      "https://objects.example.test?token=value",
      "http://objects.example.test",
    ]) {
      expect(() => loadInstructionsS3Config({
        HASNA_INSTRUCTIONS_S3_BUCKET: "valid-bucket",
        HASNA_INSTRUCTIONS_S3_ENDPOINT: endpoint,
      })).toThrow("endpoint");
    }

    expect(loadInstructionsS3Config({
      HASNA_INSTRUCTIONS_S3_BUCKET: "valid-bucket",
      HASNA_INSTRUCTIONS_S3_ENDPOINT: "http://127.0.0.1:9000",
      HASNA_INSTRUCTIONS_S3_FORCE_PATH_STYLE: "1",
    })?.endpoint).toBe("http://127.0.0.1:9000");
  });

  test("rejects invalid buckets, regions, booleans, and prefixes", () => {
    expect(() => loadInstructionsS3Config({ HASNA_INSTRUCTIONS_S3_BUCKET: "Bad_Bucket" })).toThrow("bucket");
    expect(() => loadInstructionsS3Config({
      HASNA_INSTRUCTIONS_S3_BUCKET: "valid-bucket",
      HASNA_INSTRUCTIONS_AWS_REGION: "../../region",
    })).toThrow("region");
    expect(() => loadInstructionsS3Config({
      HASNA_INSTRUCTIONS_S3_BUCKET: "valid-bucket",
      HASNA_INSTRUCTIONS_S3_FORCE_PATH_STYLE: "sometimes",
    })).toThrow("boolean");

    for (const prefix of ["a//b", "a/../b", "a\\b", "a/%2e%2e/b", "a\u0000b"]) {
      expect(() => normalizeInstructionsS3Prefix(prefix)).toThrow("prefix");
    }
  });
});
