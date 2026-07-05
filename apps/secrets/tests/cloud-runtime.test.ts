import { afterEach, describe, expect, it } from "bun:test";
import {
  CANONICAL_SECRETS_AWS_SECRET_PATH,
  CANONICAL_SECRETS_S3_SECRET_PATH,
  createAwsSecretsManagerReference,
  createCloudSecretReference,
  getCloudRuntimeReferenceStatus,
} from "../src/cloud-runtime.js";

const ENV_KEYS = [
  "HASNA_SECRETS_DB_PATH",
  "OPEN_SECRETS_DB",
  "HASNA_SECRETS_DATABASE_URL",
  "SECRETS_DATABASE_URL",
  "HASNA_SECRETS_STORAGE_MODE",
  "SECRETS_STORAGE_MODE",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("cloud runtime secret reference contract", () => {
  it("creates AWS Secrets Manager references without embedding values", () => {
    const reference = createAwsSecretsManagerReference({
      secretId: "hasna/xyz/opensource/secrets/prod/rds",
      region: "us-east-1",
      field: "database_url",
      purpose: "cloud runtime database connection",
    });

    expect(reference).toEqual({
      service: "secrets",
      schemaVersion: "1.0",
      provider: "aws-secrets-manager",
      secretId: "hasna/xyz/opensource/secrets/prod/rds",
      region: "us-east-1",
      field: "database_url",
      purpose: "cloud runtime database connection",
      resolution: "runtime-consumer",
      valueIncluded: false,
      diagnosticsOnly: true,
    });
    expect(JSON.stringify(reference)).not.toContain("postgres://");
    expect(JSON.stringify(reference)).not.toContain("SecretString");
  });

  it("fails closed for unsupported providers and accidental value fields", () => {
    const providerValue = "postgres://user:password@example.test/secrets";
    expect(() =>
      createCloudSecretReference({
        secretId: "hasna/xyz/opensource/secrets/prod/rds",
      })
    ).toThrow("requires provider");

    expect(() =>
      createCloudSecretReference({
        provider: providerValue as never,
        secretId: "HASNA_SECRETS_DATABASE_URL",
      })
    ).toThrow("Unsupported cloud secret reference provider");
    try {
      createCloudSecretReference({
        provider: providerValue as never,
        secretId: "HASNA_SECRETS_DATABASE_URL",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(providerValue);
      expect((error as Error).message).not.toContain("password");
    }

    expect(() =>
      createAwsSecretsManagerReference({
        secretId: "hasna/xyz/opensource/secrets/prod/rds",
        secretString: "raw-secret-value",
      })
    ).toThrow("must not include secret values");

    expect(() =>
      createAwsSecretsManagerReference({
        secretId: "hasna/xyz/opensource/secrets/prod/rds",
        clientSecret: "raw-secret-value",
      })
    ).toThrow("must not include secret values");

    expect(() =>
      createAwsSecretsManagerReference({
        secretId: "postgres://user:password@example.test/secrets",
      })
    ).toThrow("AWS Secrets Manager name or ARN");
  });

  it("reports local, remote Postgres, S3, and AWS behavior as metadata only", () => {
    process.env.HASNA_SECRETS_DB_PATH = "/private/account/demo-host/vault.db";
    process.env.HASNA_SECRETS_DATABASE_URL = "postgres://user:password@example.test/secrets?sslmode=query-secret&password=query-secret";
    process.env.HASNA_SECRETS_STORAGE_MODE = "remote";

    const status = getCloudRuntimeReferenceStatus();

    expect(status.local.sqlite).toMatchObject({
      provider: "local-sqlite",
      activePath: "<custom-database-path>",
      includesRows: false,
      includesValues: false,
    });
    expect(status.local.files).toMatchObject({
      provider: "local-files",
      cloudRuntimeBackingStore: false,
      includesFileContents: false,
      includesValues: false,
    });
    expect(status.remote.postgres).toMatchObject({
      provider: "remote-postgres",
      enabled: true,
      mode: "remote",
      database: {
        configured: true,
        redacted_url: "postgres://user:***@example.test/secrets?sslmode=***",
      },
      includesRows: false,
      includesValues: false,
      noNetwork: true,
    });
    expect(status.remote.s3).toMatchObject({
      provider: "remote-s3",
      runtimeObjectStore: false,
      canonicalSecretPath: CANONICAL_SECRETS_S3_SECRET_PATH,
      includesObjects: false,
      includesValues: false,
      noNetwork: true,
    });
    expect(status.aws.secretsManager).toMatchObject({
      provider: "aws-secrets-manager",
      supportedReferenceProvider: true,
      valueResolutionOwner: "runtime-consumer",
      diagnosticsReadSecretValues: false,
      diagnosticsMutateCloudResources: false,
      dryRunMutatesCloudResources: false,
    });
    expect(status.aws.secretsManager.canonicalRuntimeSecretPaths.aws).toBe(CANONICAL_SECRETS_AWS_SECRET_PATH);

    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("postgres://user:password");
    expect(serialized).not.toContain("query-secret");
    expect(serialized).not.toContain("/private/account/demo-host");
    expect(status.safety).toMatchObject({
      includesSecretValues: false,
      includesRawEnvValues: false,
      includesAwsSecretString: false,
      includesRemoteRows: false,
      includesLocalFileContents: false,
      metadataOnlyDiagnostics: true,
      failsClosedForUnsupportedProviders: true,
    });
  });
});
