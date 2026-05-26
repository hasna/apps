import { afterEach, describe, expect, test } from "bun:test";
import { createS3ClientConfig, setS3CredentialProviderFactoryForTests } from "./s3.js";
import type { Source } from "../types/index.js";

afterEach(() => {
  setS3CredentialProviderFactoryForTests();
});

describe("S3 client configuration", () => {
  test("uses an AWS named profile when S3 source config specifies one", async () => {
    let requestedProfile: string | undefined;
    setS3CredentialProviderFactoryForTests(((options: { profile?: string }) => {
      requestedProfile = options.profile;
      return async () => ({ accessKeyId: "profile-access", secretAccessKey: "profile-secret" });
    }) as typeof import("@aws-sdk/credential-providers").fromIni);

    const config = createS3ClientConfig(s3Source({ config: { profile: "hasna-xyz-infra" } }));

    expect(requestedProfile).toBe("hasna-xyz-infra");
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
        profile: "hasna-xyz-infra",
      },
    }));

    expect(requestedProfile).toBeUndefined();
    expect(config.credentials).toMatchObject({
      accessKeyId: "static-access",
      secretAccessKey: "static-secret",
    });
  });
});

function s3Source(overrides: Partial<Source> = {}): Source {
  return {
    id: "src_test",
    name: "S3",
    type: "s3",
    bucket: "hasna-xyz-prod-files",
    region: "us-east-1",
    config: {},
    machine_id: "machine",
    enabled: true,
    file_count: 0,
    created_at: "2026-05-26T00:00:00.000Z",
    updated_at: "2026-05-26T00:00:00.000Z",
    ...overrides,
  };
}
