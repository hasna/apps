import { describe, expect, test } from "bun:test";
import {
  createAwsSecretsManagerClientConfig,
  PROVIDER_BOOTSTRAP_INVARIANT_SQL,
  PROVIDER_BOOTSTRAP_MEMBERSHIPS_SQL,
  PROVIDER_CREDENTIAL_SPECS,
  reconcileProviderCredentials,
  resolveProviderCredentialOptions,
  type BootstrapProbe,
  type ProviderCredentialDatabase,
  type ProviderCredentialOptions,
  type ProviderCredentialSecretStore,
} from "./provider-credentials.js";

type AppPurpose = keyof typeof PROVIDER_CREDENTIAL_SPECS;
type ServicePurpose = Exclude<AppPurpose, "migrator">;
type Stage = "AWSCURRENT" | "AWSPENDING";

const options: ProviderCredentialOptions = {
  region: "us-east-1",
  credentialsRelativeUri: "/v2/credentials/open-loops-task",
  masterSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-loops/master-AbCd12",
  migratorSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-loops/migrator-AbCd12",
  runtimeSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-loops/runtime-AbCd12",
  authenticatorSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-loops/authenticator-AbCd12",
  expectedInstanceId: "open-loops-prod",
  expectedEndpoint: "open-loops-prod.abcdefghijkl.us-east-1.rds.amazonaws.com",
  expectedPort: 5432,
  expectedDatabase: "open_loops",
  expectedMasterUsername: "postgres_admin",
};

const masterSecret = JSON.stringify({
  engine: "postgres",
  host: options.expectedEndpoint,
  port: options.expectedPort,
  dbname: options.expectedDatabase,
  username: options.expectedMasterUsername,
  password: "test-only-master-password",
  dbInstanceIdentifier: options.expectedInstanceId,
});

function dsnFor(purpose: AppPurpose, password: string): string {
  const url = new URL("postgresql://placeholder/");
  url.username = PROVIDER_CREDENTIAL_SPECS[purpose].login;
  url.password = password;
  url.hostname = options.expectedEndpoint;
  url.port = String(options.expectedPort);
  url.pathname = `/${options.expectedDatabase}`;
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

class MemorySecretStore implements ProviderCredentialSecretStore {
  readonly operations: string[] = [];
  private versions = 0;

  constructor(private readonly values = new Map<string, Partial<Record<Stage, { value: string; versionId: string }>>>()) {}

  async get(secretId: string, stage: Stage) {
    this.operations.push(`get:${nameOfSecret(secretId)}:${stage}`);
    return this.values.get(secretId)?.[stage];
  }

  async putPending(secretId: string, value: string) {
    this.operations.push(`put:${nameOfSecret(secretId)}:AWSPENDING`);
    const pending = { value, versionId: `pending-${++this.versions}` };
    const stages = this.values.get(secretId) ?? {};
    stages.AWSPENDING = pending;
    this.values.set(secretId, stages);
    return pending;
  }

  async promote(secretId: string, pendingVersionId: string, currentVersionId?: string) {
    this.operations.push(`promote:${nameOfSecret(secretId)}:${pendingVersionId}:${currentVersionId ?? "none"}`);
    const stages = this.values.get(secretId);
    if (!stages?.AWSPENDING || stages.AWSPENDING.versionId !== pendingVersionId) {
      throw new Error("missing pending version");
    }
    stages.AWSCURRENT = stages.AWSPENDING;
    delete stages.AWSPENDING;
  }

  value(secretId: string, stage: Stage): string | undefined {
    return this.values.get(secretId)?.[stage]?.value;
  }
}

class FakeProviderDatabase implements ProviderCredentialDatabase {
  readonly operations: string[] = [];
  readonly memberships = new Map<ServicePurpose, boolean>([
    ["runtime", false],
    ["authenticator", false],
  ]);
  readonly passwords = new Map<AppPurpose, string>();

  constructor(private readonly phase: "pre_0010" | "post_0010") {}

  async bootstrapBeforeSecrets() {
    this.operations.push("bootstrap");
  }

  async setPassword(purpose: AppPurpose, password: string) {
    this.operations.push(`set:${purpose}`);
    this.passwords.set(purpose, password);
  }

  async inspectCredential(purpose: AppPurpose, dsn: string, attached: boolean) {
    const url = new URL(dsn);
    const passwordMatches = decodeURIComponent(url.password) === this.passwords.get(purpose);
    const membershipMatches = purpose === "migrator"
      ? attached === false
      : this.memberships.get(purpose) === attached;
    const loginMatches = decodeURIComponent(url.username) === PROVIDER_CREDENTIAL_SPECS[purpose].login;
    const valid = passwordMatches && membershipMatches && loginMatches;
    this.operations.push(`inspect:${purpose}:${attached}:${valid ? "valid" : "invalid"}`);
    return { valid, enforcementApplied: this.phase === "post_0010" };
  }

  async probeMigrator() {
    this.operations.push("probe-migrator");
    return this.phase;
  }

  async attachService(purpose: ServicePurpose) {
    this.operations.push(`attach:${purpose}`);
    this.memberships.set(purpose, true);
  }

  async detachService(purpose: ServicePurpose) {
    this.operations.push(`detach:${purpose}`);
    this.memberships.set(purpose, false);
  }

  async close() {
    this.operations.push("close");
  }
}

function nameOfSecret(secretId: string): string {
  if (secretId === options.masterSecretArn) return "master";
  if (secretId === options.migratorSecretArn) return "migrator";
  if (secretId === options.runtimeSecretArn) return "runtime";
  if (secretId === options.authenticatorSecretArn) return "authenticator";
  return "unknown";
}

function storeWithMaster(entries: Partial<Record<AppPurpose, string>> = {}): MemorySecretStore {
  const values = new Map<string, Partial<Record<Stage, { value: string; versionId: string }>>>();
  values.set(options.masterSecretArn, { AWSCURRENT: { value: masterSecret, versionId: "master-current" } });
  for (const [purpose, value] of Object.entries(entries) as Array<[AppPurpose, string]>) {
    values.set(options[PROVIDER_CREDENTIAL_SPECS[purpose].secretOption], {
      AWSCURRENT: { value, versionId: `${purpose}-current` },
    });
  }
  return new MemorySecretStore(values);
}

const bootstrapProbe: BootstrapProbe = async () => undefined;

describe("provider database credential reconciliation", () => {
  test("requires ECS task-role credentials, matching secret ARNs, and exact RDS endpoint inputs", () => {
    const env = {
      AWS_REGION: options.region,
      AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: options.credentialsRelativeUri,
      HASNA_LOOPS_RDS_MASTER_SECRET_ARN: options.masterSecretArn,
      HASNA_LOOPS_MIGRATOR_DATABASE_URL_SECRET_ARN: options.migratorSecretArn,
      HASNA_LOOPS_RUNTIME_DATABASE_URL_SECRET_ARN: options.runtimeSecretArn,
      HASNA_LOOPS_AUTH_DATABASE_URL_SECRET_ARN: options.authenticatorSecretArn,
      HASNA_LOOPS_RDS_INSTANCE_ID: options.expectedInstanceId,
      HASNA_LOOPS_RDS_ENDPOINT: options.expectedEndpoint,
      HASNA_LOOPS_RDS_PORT: String(options.expectedPort),
      HASNA_LOOPS_RDS_DATABASE: options.expectedDatabase,
      HASNA_LOOPS_RDS_MASTER_USERNAME: options.expectedMasterUsername,
    };
    expect(resolveProviderCredentialOptions(env)).toEqual(options);
    expect(() => resolveProviderCredentialOptions({ ...env, AWS_ACCESS_KEY_ID: "static-key" }))
      .toThrow("database credential task-role configuration is invalid");
    for (const name of [
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_PROFILE",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
      "AWS_ROLE_ARN",
      "AWS_CONTAINER_AUTHORIZATION_TOKEN",
    ]) {
      expect(() => resolveProviderCredentialOptions({ ...env, [name]: "ambient-input" }))
        .toThrow("database credential task-role configuration is invalid");
    }
    expect(() => resolveProviderCredentialOptions({ ...env, AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://127.0.0.1/creds" }))
      .toThrow("database credential task-role configuration is invalid");
    expect(() => resolveProviderCredentialOptions({ ...env, HASNA_LOOPS_RDS_ENDPOINT: "localhost" }))
      .toThrow("database credential configuration is invalid");
    expect(() => resolveProviderCredentialOptions({ ...env, HASNA_LOOPS_RDS_ENDPOINT: "db.example.com" }))
      .toThrow("database credential configuration is invalid");
    expect(() => resolveProviderCredentialOptions({
      ...env,
      HASNA_LOOPS_RUNTIME_DATABASE_URL_SECRET_ARN:
        "arn:aws:secretsmanager:us-west-2:123456789012:secret:open-loops/runtime-AbCd12",
    })).toThrow("database credential configuration is invalid");
  });

  test("pins Secrets Manager credentials to the validated ECS task-role metadata endpoint", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const config = createAwsSecretsManagerClientConfig(options, async (input, init) => {
      requests.push({ input, init });
      return new Response(JSON.stringify({
        AccessKeyId: "ecs-access",
        SecretAccessKey: "opaque",
        Token: "session",
        Expiration: "2099-01-01T00:00:00Z",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const originalEnv = {
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_PROFILE: process.env.AWS_PROFILE,
      AWS_WEB_IDENTITY_TOKEN_FILE: process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
      AWS_CONTAINER_CREDENTIALS_FULL_URI: process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI,
    };
    process.env.AWS_ACCESS_KEY_ID = "ambient-access";
    process.env.AWS_PROFILE = "ambient-profile";
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE = "/tmp/ambient-web-identity";
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = "http://127.0.0.1/ambient";
    try {
      expect(config.region).toBe(options.region);
      expect(typeof config.credentials).toBe("function");
      if (typeof config.credentials !== "function") throw new Error("expected credentials provider");
      const credentials = await config.credentials();
      expect(credentials).toMatchObject({
        accessKeyId: "ecs-access",
        secretAccessKey: "opaque",
        sessionToken: "session",
      });
      expect(credentials.expiration).toEqual(new Date("2099-01-01T00:00:00Z"));
      expect(requests).toEqual([{
        input: `http://169.254.170.2${options.credentialsRelativeUri}`,
        init: { method: "GET", redirect: "error" },
      }]);
    } finally {
      for (const [name, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("writes AWSPENDING, changes each password, verifies fresh connections, and promotes AWSCURRENT", async () => {
    const store = storeWithMaster();
    const database = new FakeProviderDatabase("post_0010");
    const randomRequests: number[] = [];
    const result = await reconcileProviderCredentials(options, {
      secretStore: store,
      createDatabase: () => database,
      random: (bytes) => {
        randomRequests.push(bytes);
        return new Uint8Array(bytes).fill(7);
      },
      bootstrapProbe,
    });

    expect(result).toMatchObject({ status: "ok", phase: "post_0010", affectedSecrets: 3 });
    expect(randomRequests).toEqual([48, 48, 48]);
    for (const purpose of ["migrator", "runtime", "authenticator"] as const) {
      const secretId = options[PROVIDER_CREDENTIAL_SPECS[purpose].secretOption];
      const current = store.value(secretId, "AWSCURRENT");
      expect(current).toBeDefined();
      const parsed = new URL(current!);
      expect(parsed.searchParams.get("sslmode")).toBe("verify-full");
      expect(decodeURIComponent(parsed.username)).toBe(PROVIDER_CREDENTIAL_SPECS[purpose].login);
      expect(decodeURIComponent(parsed.password)).toHaveLength(64);
      expect(store.value(secretId, "AWSPENDING")).toBeUndefined();
    }

    const operations = [...store.operations, ...database.operations];
    expect(operations).toContain("put:migrator:AWSPENDING");
    expect(operations).toContain("set:migrator");
    expect(operations).toContain("promote:migrator:pending-1:none");
    expect(database.operations).toEqual(expect.arrayContaining([
      "bootstrap",
      "probe-migrator",
      "detach:runtime",
      "attach:runtime",
      "detach:authenticator",
      "attach:authenticator",
      "close",
    ]));
    expect(database.operations.indexOf("set:runtime")).toBeLessThan(database.operations.indexOf("attach:runtime"));
    expect(store.operations.indexOf("put:runtime:AWSPENDING")).toBeLessThan(store.operations.findIndex((op) => op.startsWith("promote:runtime:")));
  });

  test("is idempotent when current post-0010 credentials and service memberships are already valid", async () => {
    const migratorDsn = dsnFor("migrator", "current-migrator");
    const runtimeDsn = dsnFor("runtime", "current-runtime");
    const authenticatorDsn = dsnFor("authenticator", "current-authenticator");
    const store = storeWithMaster({ migrator: migratorDsn, runtime: runtimeDsn, authenticator: authenticatorDsn });
    const database = new FakeProviderDatabase("post_0010");
    database.passwords.set("migrator", "current-migrator");
    database.passwords.set("runtime", "current-runtime");
    database.passwords.set("authenticator", "current-authenticator");
    database.memberships.set("runtime", true);
    database.memberships.set("authenticator", true);

    const result = await reconcileProviderCredentials(options, {
      secretStore: store,
      createDatabase: () => database,
      random: () => {
        throw new Error("random should not be used for valid current credentials");
      },
      bootstrapProbe,
    });

    expect(result).toMatchObject({ phase: "post_0010", affectedSecrets: 0 });
    expect(store.operations.some((op) => op.startsWith("put:"))).toBe(false);
    expect(store.operations.some((op) => op.startsWith("promote:"))).toBe(false);
    expect(database.operations.some((op) => op.startsWith("set:"))).toBe(false);
    expect(database.operations.some((op) => op.startsWith("detach:"))).toBe(false);
    expect(database.operations.some((op) => op.startsWith("attach:"))).toBe(false);
  });

  test("keeps runtime and authenticator logins detached before tenant enforcement 0010", async () => {
    const runtimeDsn = dsnFor("runtime", "current-runtime");
    const authenticatorDsn = dsnFor("authenticator", "current-authenticator");
    const store = storeWithMaster({ runtime: runtimeDsn, authenticator: authenticatorDsn });
    const database = new FakeProviderDatabase("pre_0010");
    database.passwords.set("runtime", "current-runtime");
    database.passwords.set("authenticator", "current-authenticator");
    const randomRequests: number[] = [];

    await reconcileProviderCredentials(options, {
      secretStore: store,
      createDatabase: () => database,
      random: (bytes) => {
        randomRequests.push(bytes);
        return new Uint8Array(bytes).fill(9);
      },
      bootstrapProbe,
    });

    expect(database.operations).toContain("detach:runtime");
    expect(database.operations).toContain("detach:authenticator");
    expect(database.operations).not.toContain("attach:runtime");
    expect(database.operations).not.toContain("attach:authenticator");
    expect(database.memberships.get("runtime")).toBe(false);
    expect(database.memberships.get("authenticator")).toBe(false);
    expect(randomRequests).toEqual([48]);
  });

  test("provider bootstrap only normalizes Loops memberships on the provider session user", () => {
    expect(PROVIDER_BOOTSTRAP_MEMBERSHIPS_SQL).toContain("member.rolname=session_user");
    expect(PROVIDER_BOOTSTRAP_MEMBERSHIPS_SQL).toContain("AND granted.rolname IN");
    expect(PROVIDER_BOOTSTRAP_MEMBERSHIPS_SQL).toContain("'open_loops_owner', 'open_loops_migrator'");
    expect(PROVIDER_BOOTSTRAP_MEMBERSHIPS_SQL).not.toContain("WHERE member.rolname IN (\n       session_user");
    expect(PROVIDER_BOOTSTRAP_INVARIANT_SQL).toContain("member.rolname = session_user");
    expect(PROVIDER_BOOTSTRAP_INVARIANT_SQL).toContain("AND granted.rolname IN");
    expect(PROVIDER_BOOTSTRAP_INVARIANT_SQL).toContain("AND NOT EXISTS");
  });
});
