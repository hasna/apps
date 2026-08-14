import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDb, resetDb } from "../src/db.js";
import {
  getAwsSecretValueForEnv,
  getAwsSecretValue,
  pushSecret,
  resolveAwsAccountProfile,
  resolveAwsConfig,
  resolveAwsEnvSecretName,
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
    process.env.AWS_PROFILE = "example-aws-profile";

    const resolved = resolveAwsConfig({}, null);

    expect(resolved.credentialMode).toBe("profile");
    expect(resolved.profile).toBe("example-aws-profile");
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

describe("AWS account-scoped exec selection", () => {
  const profiles = {
    hasna: { region: "us-east-1" },
    "hasna-example-infra": {
      role_arn: "arn:aws:iam::123456789012:role/ExampleAccessRole",
      source_profile: "hasna",
      region: "eu-west-1",
    },
    unrelated: {
      role_arn: "arn:aws:iam::210987654321:role/ExampleAccessRole",
      source_profile: "other-provider",
    },
  };

  it("selects the unique configured role profile for provider and account", () => {
    expect(resolveAwsAccountProfile("hasna", "123456789012", profiles)).toEqual({
      profile: "hasna-example-infra",
      region: "eu-west-1",
    });
  });

  it("refuses an account that the provider has not configured", () => {
    expect(() => resolveAwsAccountProfile("hasna", "999999999999", profiles)).toThrow(
      "No AWS profile",
    );
  });

  it("reads the exact remote env secret without writing it into the local vault", async () => {
    const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
    setAwsClientFactoryForTests(() => ({
      send: async (command: any) => {
        sent.push({ name: command.constructor.name, input: command.input });
        return { SecretString: "synthetic-account-secret", VersionId: "synthetic-version" };
      },
    }));

    const value = await getAwsSecretValue("EXAMPLE_NPM_TOKEN", {
      credentialMode: "profile",
      profile: "hasna-example-infra",
      region: "eu-west-1",
    });

    expect(value).toBe("synthetic-account-secret");
    expect(sent).toEqual([
      {
        name: "GetSecretValueCommand",
        input: { SecretId: "EXAMPLE_NPM_TOKEN", VersionStage: "AWSCURRENT" },
      },
    ]);
    expect(await _store.getSecret("EXAMPLE_NPM_TOKEN")).toBeUndefined();
  });

  it("maps one canonical provider path to its normalized environment name", () => {
    expect(resolveAwsEnvSecretName(
      "hasna",
      "HASNA_TODOS_API_KEY",
      ["unrelated/oss/todos/api-key", "hasna/oss/todos/api-key"],
    )).toBe("hasna/oss/todos/api-key");
  });

  it("preserves an exact remote-name selector", () => {
    expect(resolveAwsEnvSecretName(
      "hasna",
      "HASNA_LEGACY_TOKEN",
      ["hasna/oss/legacy/token", "HASNA_LEGACY_TOKEN"],
    )).toBe("HASNA_LEGACY_TOKEN");
  });

  it("refuses canonical names that collide after environment normalization", () => {
    expect(() => resolveAwsEnvSecretName(
      "hasna",
      "HASNA_TODOS_API_KEY",
      ["hasna/oss/todos/api-key", "hasna/oss/todos/api_key"],
    )).toThrow("Multiple AWS secrets map to environment variable");
  });

  it("resolves a canonical env selector through every metadata page before one value read", async () => {
    const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
    setAwsClientFactoryForTests(() => ({
      send: async (command: any) => {
        sent.push({ name: command.constructor.name, input: command.input });
        if (command.constructor.name === "ListSecretsCommand") {
          if (!command.input.NextToken) {
            return {
              SecretList: [{
                Name: "hasna/oss/other/token",
                SecretVersionsToStages: { "fixture-other-version": ["AWSCURRENT"] },
              }],
              NextToken: "fixture-page-2",
            };
          }
          return {
            SecretList: [{
              Name: "hasna/oss/todos/api-key",
              SecretVersionsToStages: { "fixture-current-version": ["AWSCURRENT"] },
            }],
          };
        }
        if (command.constructor.name === "GetSecretValueCommand") {
          if (command.input.SecretId === "HASNA_TODOS_API_KEY") {
            throw { name: "ResourceNotFoundException" };
          }
          return { SecretString: "fixture-account-value", VersionId: "fixture-current-version" };
        }
        throw new Error("unexpected command");
      },
    }));

    const value = await getAwsSecretValueForEnv("hasna", "HASNA_TODOS_API_KEY", {
      credentialMode: "profile",
      profile: "hasna-example-infra",
      region: "eu-west-1",
    });

    expect(value).toBe("fixture-account-value");
    expect(sent.map(({ name }) => name)).toEqual([
      "GetSecretValueCommand",
      "ListSecretsCommand",
      "ListSecretsCommand",
      "GetSecretValueCommand",
    ]);
    expect(sent[3]?.input).toEqual({
      SecretId: "hasna/oss/todos/api-key",
      VersionStage: "AWSCURRENT",
      VersionId: "fixture-current-version",
    });
  });

  it("uses an exact remote name without requiring list permission", async () => {
    const sent: string[] = [];
    setAwsClientFactoryForTests(() => ({
      send: async (command: any) => {
        const name = command.constructor.name;
        sent.push(name);
        if (name === "GetSecretValueCommand") {
          return { SecretString: "fixture-legacy-value", VersionId: "fixture-current-version" };
        }
        throw new Error("list permission refused");
      },
    }));

    expect(await getAwsSecretValueForEnv("hasna", "HASNA_LEGACY_TOKEN", {
      credentialMode: "profile",
      profile: "hasna-example-infra",
    })).toBe("fixture-legacy-value");
    expect(sent).toEqual(["GetSecretValueCommand"]);
  });

  it("fails closed before a value read on zero or ambiguous normalized matches", async () => {
    for (const secretNames of [
      ["hasna/oss/other/token"],
      ["hasna/oss/todos/api-key", "hasna/oss/todos/api_key"],
    ]) {
      const sent: string[] = [];
      setAwsClientFactoryForTests(() => ({
        send: async (command: any) => {
          const name = command.constructor.name;
          sent.push(name);
          if (name === "GetSecretValueCommand") throw { name: "ResourceNotFoundException" };
          if (name === "ListSecretsCommand") {
            return {
              SecretList: secretNames.map((Name) => ({
                Name,
                SecretVersionsToStages: { "fixture-current-version": ["AWSCURRENT"] },
              })),
            };
          }
          throw new Error("value read must not run");
        },
      }));

      let message = "";
      try {
        await getAwsSecretValueForEnv("hasna", "HASNA_TODOS_API_KEY", {
          credentialMode: "profile",
          profile: "hasna-example-infra",
        });
      } catch (error: any) {
        message = error.message;
      }
      expect(message).toMatch(/No AWS secret maps|Multiple AWS secrets map/);
      expect(message).not.toContain("hasna/oss/");
      expect(sent).toEqual(["GetSecretValueCommand", "ListSecretsCommand"]);
    }
  });

  it("detects a normalized collision introduced on a later metadata page", async () => {
    const sent: string[] = [];
    setAwsClientFactoryForTests(() => ({
      send: async (command: any) => {
        const name = command.constructor.name;
        sent.push(name);
        if (name === "GetSecretValueCommand") throw { name: "ResourceNotFoundException" };
        if (name === "ListSecretsCommand" && !command.input.NextToken) {
          return {
            SecretList: [{
              Name: "hasna/oss/todos/api-key",
              SecretVersionsToStages: { "fixture-version-a": ["AWSCURRENT"] },
            }],
            NextToken: "fixture-page-2",
          };
        }
        if (name === "ListSecretsCommand") {
          return {
            SecretList: [{
              Name: "hasna/oss/todos/api_key",
              SecretVersionsToStages: { "fixture-version-b": ["AWSCURRENT"] },
            }],
          };
        }
        throw new Error("value read must not run");
      },
    }));

    await expect(getAwsSecretValueForEnv("hasna", "HASNA_TODOS_API_KEY", {
      credentialMode: "profile",
      profile: "hasna-example-infra",
    })).rejects.toThrow("Multiple AWS secrets map");
    expect(sent).toEqual([
      "GetSecretValueCommand",
      "ListSecretsCommand",
      "ListSecretsCommand",
    ]);
  });

  it("fails closed on list errors and missing AWSCURRENT metadata", async () => {
    for (const listResult of [new Error("fixture list refused"), {
      SecretList: [{ Name: "hasna/oss/todos/api-key", SecretVersionsToStages: {} }],
    }]) {
      const sent: string[] = [];
      setAwsClientFactoryForTests(() => ({
        send: async (command: any) => {
          const name = command.constructor.name;
          sent.push(name);
          if (name === "GetSecretValueCommand") throw { name: "ResourceNotFoundException" };
          if (name === "ListSecretsCommand") {
            if (listResult instanceof Error) throw listResult;
            return listResult;
          }
          throw new Error("value read must not run");
        },
      }));

      await expect(getAwsSecretValueForEnv("hasna", "HASNA_TODOS_API_KEY", {
        credentialMode: "profile",
        profile: "hasna-example-infra",
      })).rejects.toThrow();
      expect(sent).toEqual(["GetSecretValueCommand", "ListSecretsCommand"]);
    }
  });

  it("fails closed on read errors and non-string values without exposing the value", async () => {
    for (const readResult of [new Error("fixture read refused"), {
      SecretBinary: new Uint8Array([1, 2, 3]),
      VersionId: "fixture-current-version",
    }]) {
      setAwsClientFactoryForTests(() => ({
        send: async (command: any) => {
          const name = command.constructor.name;
          if (name === "GetSecretValueCommand") {
            if (readResult instanceof Error) throw readResult;
            return readResult;
          }
          throw new Error("unexpected command");
        },
      }));

      let message = "";
      try {
        await getAwsSecretValueForEnv("hasna", "HASNA_LEGACY_TOKEN", {
          credentialMode: "profile",
          profile: "hasna-example-infra",
        });
      } catch (error: any) {
        message = error.message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("fixture-legacy-value");
    }
  });

  it("redacts the selected canonical name when its value read fails", async () => {
    const remoteName = "hasna/oss/todos/api-key";
    setAwsClientFactoryForTests(() => ({
      send: async (command: any) => {
        if (command.constructor.name === "GetSecretValueCommand" &&
          command.input.SecretId === "HASNA_TODOS_API_KEY") {
          throw { name: "ResourceNotFoundException" };
        }
        if (command.constructor.name === "ListSecretsCommand") {
          return {
            SecretList: [{
              Name: remoteName,
              SecretVersionsToStages: { "fixture-current-version": ["AWSCURRENT"] },
            }],
          };
        }
        throw new Error(`fixture read refused for ${remoteName}`);
      },
    }));

    let message = "";
    try {
      await getAwsSecretValueForEnv("hasna", "HASNA_TODOS_API_KEY", {
        credentialMode: "profile",
        profile: "hasna-example-infra",
      });
    } catch (error: any) {
      message = error.message;
    }
    expect(message).toContain("Unable to read AWS secret selected");
    expect(message).not.toContain(remoteName);
  });

  it("uses the refusing client when no fake AWS client is installed", async () => {
    setAwsClientFactoryForTests();
    await expect(getAwsSecretValueForEnv("hasna", "HASNA_TODOS_API_KEY", {
      credentialMode: "profile",
      profile: "hasna-example-infra",
    })).rejects.toThrow("Test isolation");
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
    await setSecret("example/app/prod/s3", "secret-value", "credential");
    getDb()
      .prepare("UPDATE secrets SET value = ? WHERE key = ?")
      .run("enc:v1:malformed", "example/app/prod/s3");

    const plan = await pushSecret("example/app/prod/s3", {
      dryRun: true,
      profile: "example-aws-profile",
      prefix: "test-prefix",
    });

    expect(sends).toBe(0);
    expect(plan?.dryRun).toBe(true);
    expect(plan?.actions).toEqual([
      expect.objectContaining({
        action: "push",
        key: "example/app/prod/s3",
        awsName: "test-prefix/example/app/prod/s3",
        mutation: "none",
      }),
    ]);
  });

  it("awaits the local metadata read so the push plan cannot leak a pending store call", async () => {
    // Regression for aws-push-dryrun-hang: pushSecret's dry-run branch used to call
    // getLocalMetadata(key) WITHOUT awaiting it, so `metadata` was always a (truthy)
    // Promise. That made the `Secret not found` guard dead code AND — in cloud/api
    // mode, where getLocalMetadata performs an HTTP round trip — left an in-flight
    // socket that kept the event loop alive, so the keyless `aws push --dry-run`
    // plan-all path never exited. If the read is properly awaited, a dry-run push of
    // a key that does not exist locally must reject instead of returning a plan.
    setAwsClientFactoryForTests(() => ({
      send: async () => {
        throw new Error("dry-run must not send");
      },
    }));

    await expect(
      pushSecret("example/app/prod/does-not-exist", {
        dryRun: true,
        profile: "example-aws-profile",
        prefix: "test-prefix",
      })
    ).rejects.toThrow("Secret not found");
  });

  it("plans sync with metadata-only local reads and remote ListSecrets", async () => {
    const sent: string[] = [];
    setAwsClientFactoryForTests(() => ({
      send: async (command: unknown) => {
        sent.push(command?.constructor?.name ?? "UnknownCommand");
        // A real ListSecrets page carries SecretVersionsToStages, which is where
        // the AWSCURRENT version is read from. Omitting it would model a vault
        // whose versions cannot be determined and exercise the refusal path
        // instead of the reconciliation path this test is about.
        return {
          SecretList: [
            { Name: "example/app/prod/s3", SecretVersionsToStages: { "v-s3": ["AWSCURRENT"] } },
            { Name: "example/app/prod/rds", SecretVersionsToStages: { "v-rds": ["AWSCURRENT"] } },
          ],
        };
      },
    }));
    await setSecret("example/app/prod/s3", "secret-value", "credential");
    getDb()
      .prepare("UPDATE secrets SET value = ? WHERE key = ?")
      .run("enc:v1:malformed", "example/app/prod/s3");

    const result = await syncAll({ dryRun: true, profile: "example-aws-profile" });

    expect(sent).toEqual(["ListSecretsCommand"]);
    expect(result.pushed).toEqual([]);
    expect(result.pulled).toEqual([]);
    expect(result.plan?.actions).toContainEqual(
      expect.objectContaining({
        action: "pull",
        key: "example/app/prod/rds",
        mutation: "none",
      })
    );
  });
});

describe("AWS live sync (non-dry-run)", () => {
  it("pulls remote secrets that are missing locally, and refuses to push over an existing remote", async () => {
    // Regression guard: getLocalMetadata() is async, so `if (!getLocalMetadata(key))`
    // (a truthy Promise) silently skipped every pull and killed bidirectional sync.
    //
    // The push half of this test asserts the OPPOSITE of what it once did, and the
    // change is deliberate rather than a relaxed assertion. `example/app/prod/s3`
    // exists on both sides with no shared checkpoint. Sync used to resolve that by
    // pushing local over the remote, which is the data-loss bug this suite now
    // guards against, so the expected outcome is a conflict that mutates nothing.
    setAwsClientFactoryForTests(() => ({
      send: async (command: any) => {
        const name = command?.constructor?.name;
        if (name === "ListSecretsCommand") {
          return {
            SecretList: [
              { Name: "example/app/prod/s3", SecretVersionsToStages: { "v-s3": ["AWSCURRENT"] } },
              { Name: "example/app/prod/rds", SecretVersionsToStages: { "v-rds": ["AWSCURRENT"] } },
            ],
          };
        }
        if (name === "GetSecretValueCommand") {
          // VersionId is what pins the pulled value to the version that was
          // planned; a real GetSecretValue always returns it.
          return { SecretString: "remote-value", VersionId: "v-rds" };
        }
        return {};
      },
    }));

    await setSecret("example/app/prod/s3", "local-value", "credential");

    const result = await syncAll({ profile: "example-aws-profile" });

    expect(result.errors).toEqual([]);
    expect(result.pulled).toEqual(["example/app/prod/rds"]);

    // The pull actually landed — the guard this test was written for.
    const pulled = await _store.getSecret("example/app/prod/rds");
    expect(pulled?.value).toBe("remote-value");

    // No remote value was replaced, and the collision is reported rather than silently resolved.
    expect(result.pushed).toEqual([]);
    expect(result.conflicts.map((c) => c.key)).toContain("example/app/prod/s3");
  });
});
