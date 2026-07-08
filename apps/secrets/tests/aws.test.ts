import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, resetDb } from "../src/db.js";
import {
  pushSecret,
  resolveAwsConfig,
  setAwsClientFactoryForTests,
  syncAll,
} from "../src/aws.js";
import { LocalStore } from "../src/store/index.js";

const _store = new LocalStore();
const setSecret = _store.setSecret.bind(_store);

let testDir: string;

const envKeys = [
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "HASNA_SECRETS_AWS_PROFILE",
  "HASNA_SECRETS_AWS_REGION",
  "HASNA_SECRETS_AWS_PREFIX",
  "HASNA_SECRETS_AWS_CREDENTIAL_MODE",
  "HASNA_SECRETS_AWS_ROLE_ARN",
  "HASNA_SECRETS_AWS_SOURCE_PROFILE",
  "HASNA_SECRETS_AWS_EXTERNAL_ID",
  "HASNA_SECRETS_AWS_SESSION_NAME",
];

beforeEach(async () => {
  testDir = join(tmpdir(), `open-secrets-aws-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.OPEN_SECRETS_DB = join(testDir, "vault.db");
  for (const key of envKeys) delete process.env[key];
  setAwsClientFactoryForTests();
  resetDb();
});

afterEach(async () => {
  setAwsClientFactoryForTests();
  resetDb();
  delete process.env.OPEN_SECRETS_DB;
  for (const key of envKeys) delete process.env[key];
  rmSync(testDir, { recursive: true, force: true });
});

describe("AWS credential resolution", () => {
  it("keeps legacy static aws.json credentials ahead of ambient AWS_PROFILE", async () => {
    process.env.AWS_PROFILE = "ambient-profile";

    const resolved = resolveAwsConfig(
      {},
      {
        access_key_id: "AKIA_TEST",
        secret_access_key: "secret",
        region: "us-west-2",
        prefix: "legacy-prefix",
      }
    );

    expect(resolved.credentialMode).toBe("static");
    expect(resolved.profile).toBeUndefined();
    expect(resolved.region).toBe("us-west-2");
    expect(resolved.prefix).toBe("legacy-prefix");
  });

  it("uses AWS_PROFILE/default-chain when no static config exists", async () => {
    process.env.AWS_PROFILE = "hasna-xyz-infra";

    const resolved = resolveAwsConfig({}, null);

    expect(resolved.credentialMode).toBe("profile");
    expect(resolved.profile).toBe("hasna-xyz-infra");
    expect(resolved.region).toBe("us-east-1");
  });

  it("lets explicit profile and region override static config", async () => {
    const resolved = resolveAwsConfig(
      { profile: "override", region: "eu-central-1", prefix: "canonical" },
      {
        access_key_id: "AKIA_TEST",
        secret_access_key: "secret",
        region: "us-west-2",
        prefix: "legacy-prefix",
      }
    );

    expect(resolved.credentialMode).toBe("profile");
    expect(resolved.profile).toBe("override");
    expect(resolved.region).toBe("eu-central-1");
    expect(resolved.prefix).toBe("canonical");
  });

  it("resolves explicit role configuration without exposing credentials", async () => {
    const resolved = resolveAwsConfig(
      {
        credentialMode: "role",
        roleArn: "arn:aws:iam::123456789012:role/example",
        sourceProfile: "source",
        externalId: "external",
        sessionName: "open-secrets-test",
      },
      null
    );

    expect(resolved.credentialMode).toBe("role");
    expect(resolved.roleArn).toBe("arn:aws:iam::123456789012:role/example");
    expect(resolved.sourceProfile).toBe("source");
    expect(resolved.externalId).toBe("external");
    expect(resolved.staticCredentials).toBeUndefined();
  });
});

describe("AWS dry-run planning", () => {
  it("plans a push without decrypting local secret values or sending AWS commands", async () => {
    let sends = 0;
    setAwsClientFactoryForTests(() => ({
      send: async () => {
        sends++;
        throw new Error("dry-run must not send");
      },
    }));
    await setSecret("hasna/xyz/opensource/files/prod/s3", "secret-value", "credential");
    getDb()
      .prepare("UPDATE secrets SET value = ? WHERE key = ?")
      .run("enc:v1:malformed", "hasna/xyz/opensource/files/prod/s3");

    const plan = await pushSecret("hasna/xyz/opensource/files/prod/s3", {
      dryRun: true,
      profile: "hasna-xyz-infra",
      prefix: "test-prefix",
    });

    expect(sends).toBe(0);
    expect(plan?.dryRun).toBe(true);
    expect(plan?.actions).toEqual([
      expect.objectContaining({
        action: "push",
        key: "hasna/xyz/opensource/files/prod/s3",
        awsName: "test-prefix/hasna/xyz/opensource/files/prod/s3",
        mutation: "none",
      }),
    ]);
  });

  it("plans sync with metadata-only local reads and remote ListSecrets", async () => {
    const sent: string[] = [];
    setAwsClientFactoryForTests(() => ({
      send: async (command: unknown) => {
        sent.push(command?.constructor?.name ?? "UnknownCommand");
        return {
          SecretList: [
            { Name: "hasna/xyz/opensource/files/prod/s3" },
            { Name: "hasna/xyz/opensource/files/prod/rds" },
          ],
        };
      },
    }));
    await setSecret("hasna/xyz/opensource/files/prod/s3", "secret-value", "credential");
    getDb()
      .prepare("UPDATE secrets SET value = ? WHERE key = ?")
      .run("enc:v1:malformed", "hasna/xyz/opensource/files/prod/s3");

    const result = await syncAll({ dryRun: true, profile: "hasna-xyz-infra" });

    expect(sent).toEqual(["ListSecretsCommand"]);
    expect(result.pushed).toEqual([]);
    expect(result.pulled).toEqual([]);
    expect(result.plan?.actions).toContainEqual(
      expect.objectContaining({
        action: "pull",
        key: "hasna/xyz/opensource/files/prod/rds",
        mutation: "none",
      })
    );
  });
});
