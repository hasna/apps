import { afterEach, describe, expect, test } from "bun:test";
import { createS3ClientConfig, describeS3ClientConfig, getPresignedPutUrl, setS3CredentialProviderFactoryForTests } from "./s3.js";
import type { Source } from "../types/index.js";

afterEach(() => {
  setS3CredentialProviderFactoryForTests();
});

describe("presigned PUT signing", () => {
  test("signs content-type, checksum and metadata headers so a thin client's headers are covered", async () => {
    const url = await getPresignedPutUrl(
      s3Source({ config: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" } }),
      "quarantine/orgs/o/x.bin",
      {
        contentType: "application/octet-stream",
        contentLength: 10,
        checksumSha256: "a".repeat(64),
        metadata: { "asset-id": "asset_x", "org-id": "o", "app": "files", "kind": "k" },
      },
    );
    const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
    const parts = signed.split(";");
    // The regression: the SDK default hoists these to the query string, leaving
    // SignedHeaders=content-length;host, which makes S3 reject the client PUT.
    expect(parts).toContain("content-type");
    expect(parts).toContain("x-amz-checksum-sha256");
    expect(parts).toContain("x-amz-meta-asset-id");
    expect(parts).toContain("x-amz-meta-org-id");
    expect(parts).toContain("x-amz-meta-app");
    expect(parts).toContain("x-amz-meta-kind");
    // The client sends these as real HTTP headers, so they must be signed
    // headers, not hoisted into the query string.
    const query = new URL(url).searchParams;
    expect(query.has("x-amz-checksum-sha256")).toBe(false);
    expect(query.has("x-amz-meta-asset-id")).toBe(false);
    // The SDK checksum marker must NOT be a signed header (the thin client never
    // sends it); it is fine for it to ride along as a signed query param.
    expect(parts).not.toContain("x-amz-sdk-checksum-algorithm");
  });
});

describe("S3 client configuration", () => {
  test("uses an AWS named profile when S3 source config specifies one", async () => {
    let requestedProfile: string | undefined;
    setS3CredentialProviderFactoryForTests(((options: { profile?: string }) => {
      requestedProfile = options.profile;
      return async () => ({ accessKeyId: "profile-access", secretAccessKey: "profile-secret" });
    }) as typeof import("@aws-sdk/credential-providers").fromIni);

    const config = createS3ClientConfig(s3Source({ config: { profile: "files-sync" } }));

    expect(requestedProfile).toBe("files-sync");
    expect(typeof config.credentials).toBe("function");
    await expect((config.credentials as () => Promise<unknown>)()).resolves.toMatchObject({
      accessKeyId: "profile-access",
      secretAccessKey: "profile-secret",
    });
  });

  test("prefers explicit S3 credentials over an AWS profile", () => {
    let requestedProfile: string | undefined;
    setS3CredentialProviderFactoryForTests(((options: { profile?: string }) => {
      requestedProfile = options.profile;
      return async () => ({ accessKeyId: "profile-access", secretAccessKey: "profile-secret" });
    }) as typeof import("@aws-sdk/credential-providers").fromIni);

    const config = createS3ClientConfig(s3Source({
      config: {
        accessKeyId: "static-access",
        secretAccessKey: "static-secret",
        profile: "files-sync",
      },
    }));

    expect(requestedProfile).toBeUndefined();
    expect(config.credentials).toMatchObject({
      accessKeyId: "static-access",
      secretAccessKey: "static-secret",
    });
  });

  test("reports no-secret diagnostics for cloud runtime configuration", () => {
    const diagnostics = describeS3ClientConfig(s3Source({
      config: {
        profile: "files-sync",
        endpoint: "https://s3-compatible.example.test",
        forcePathStyle: true,
      },
    }));

    expect(diagnostics).toEqual({
      region: "us-west-2",
      endpoint_configured: true,
      force_path_style: true,
      credential_source: "aws_profile",
      profile_configured: true,
      static_access_key_configured: false,
      session_token_configured: false,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("files-sync");
  });

  test("passes path-style config and rejects partial static credentials", () => {
    const config = createS3ClientConfig(s3Source({ config: { forcePathStyle: true } }));

    expect(config.forcePathStyle).toBe(true);
    expect(() =>
      createS3ClientConfig(s3Source({ config: { accessKeyId: "static-access" } })),
    ).toThrow("require both accessKeyId and secretAccessKey");
    expect(() =>
      createS3ClientConfig(s3Source({ config: { secretAccessKey: "static-secret" } })),
    ).toThrow("require both accessKeyId and secretAccessKey");
  });
});

function s3Source(overrides: Partial<Source> = {}): Source {
  return {
    id: "src_test",
    name: "S3",
    type: "s3",
    bucket: "example-prod-emails",
    region: "us-west-2",
    config: {},
    machine_id: "machine",
    enabled: true,
    file_count: 0,
    created_at: "2026-05-26T00:00:00.000Z",
    updated_at: "2026-05-26T00:00:00.000Z",
    ...overrides,
  };
}
