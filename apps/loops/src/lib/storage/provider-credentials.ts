import { randomBytes, randomUUID } from "node:crypto";
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
  UpdateSecretVersionStageCommand,
  type SecretsManagerClientConfig,
} from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
import type { PoolQueryClient } from "../../generated/storage-kit/query.js";
import { PgPoolExecutor } from "./pg-executor.js";
import { PostgresStorage } from "./postgres.js";
import {
  POSTGRES_MIGRATION_ADVISORY_LOCK_SQL,
  POSTGRES_STORAGE_MIGRATIONS,
  POSTGRES_TENANT_BOOTSTRAP_ROLES_SQL,
  POSTGRES_TENANT_CLUSTER_ROLE_EXCLUSIVITY_SQL,
} from "./postgres-schema.js";

const ECS_CREDENTIALS_PATH = /^\/v2\/credentials\/[A-Za-z0-9_-]{1,128}$/;
const AWS_REGION = /^[a-z0-9]+(?:-[a-z0-9]+)+-\d+$/;
const SECRET_ARN = /^arn:(?:aws|aws-us-gov|aws-cn):secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/;
const RDS_ENDPOINT = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const DATABASE_NAME = /^[a-zA-Z_][a-zA-Z0-9_$-]{0,62}$/;
const TENANT_ENFORCEMENT_MIGRATION_ID = "0010_tenant_enforce";
const ECS_CREDENTIALS_ORIGIN = "http://169.254.170.2";

export const PROVIDER_CREDENTIAL_SPECS = Object.freeze({
  migrator: Object.freeze({
    login: "open_loops_migrator_login",
    secretOption: "migratorSecretArn" as const,
  }),
  runtime: Object.freeze({
    login: "open_loops_runtime_login",
    secretOption: "runtimeSecretArn" as const,
    role: "open_loops_runtime" as const,
  }),
  authenticator: Object.freeze({
    login: "open_loops_authenticator_login",
    secretOption: "authenticatorSecretArn" as const,
    role: "open_loops_authenticator" as const,
  }),
});

type CredentialPurpose = keyof typeof PROVIDER_CREDENTIAL_SPECS;
type ServicePurpose = Exclude<CredentialPurpose, "migrator">;
type CredentialPhase = "pre_0010" | "post_0010";
type SecretStage = "AWSCURRENT" | "AWSPENDING";

const masterSecretSchema = z.object({
  engine: z.literal("postgres"),
  host: z.string().regex(RDS_ENDPOINT),
  port: z.number().int().min(1).max(65535),
  dbname: z.string().regex(DATABASE_NAME),
  username: z.string().regex(IDENTIFIER),
  password: z.string().min(1),
  dbInstanceIdentifier: z.string().min(1).max(255),
}).strict();

interface MasterSecret {
  engine: "postgres";
  host: string;
  port: number;
  dbname: string;
  username: string;
  password: string;
  dbInstanceIdentifier: string;
}

export interface ProviderCredentialOptions {
  region: string;
  credentialsRelativeUri: string;
  masterSecretArn: string;
  migratorSecretArn: string;
  runtimeSecretArn: string;
  authenticatorSecretArn: string;
  expectedInstanceId: string;
  expectedEndpoint: string;
  expectedPort: number;
  expectedDatabase: string;
  expectedMasterUsername: string;
}

interface SecretValue {
  value: string;
  versionId: string;
}

type ProviderCredentialFetch = (input: string, init?: RequestInit) => Promise<Response>;

const ecsTaskRoleCredentialSchema = z.object({
  AccessKeyId: z.string().min(1),
  SecretAccessKey: z.string().min(1),
  Token: z.string().min(1),
  Expiration: z.string().min(1),
}).passthrough();

export interface ProviderCredentialSecretStore {
  get(secretId: string, stage: SecretStage): Promise<SecretValue | undefined>;
  putPending(secretId: string, value: string): Promise<SecretValue>;
  promote(secretId: string, pendingVersionId: string, currentVersionId?: string): Promise<void>;
}

interface CredentialInspection {
  valid: boolean;
  enforcementApplied: boolean;
}

export interface ProviderCredentialDatabase {
  bootstrapBeforeSecrets(): Promise<void>;
  setPassword(purpose: CredentialPurpose, password: string): Promise<void>;
  inspectCredential(purpose: CredentialPurpose, dsn: string, attached: boolean): Promise<CredentialInspection>;
  probeMigrator(dsn: string): Promise<CredentialPhase>;
  attachService(purpose: ServicePurpose): Promise<void>;
  detachService(purpose: ServicePurpose): Promise<void>;
  close(): Promise<void>;
}

export interface ProviderCredentialResult {
  phase: CredentialPhase;
  status: "ok";
  invariants: {
    bootstrapNormalized: true;
    transportVerified: true;
    ledgerExact: true;
    serviceMembershipsSafe: true;
  };
  affectedSecrets: number;
}

export interface ProviderCredentialDependencies {
  secretStore?: ProviderCredentialSecretStore;
  createDatabase?: (masterDsn: string, probe: BootstrapProbe) => ProviderCredentialDatabase;
  random?: (bytes: number) => Uint8Array;
  bootstrapProbe: BootstrapProbe;
}

export type BootstrapProbe = (client: PoolQueryClient, schema: PostgresStorage) => Promise<void>;

interface ReconciledCredential {
  dsn: string;
  changed: boolean;
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error("database credential configuration is invalid");
  return value;
}

export function resolveProviderCredentialOptions(env: NodeJS.ProcessEnv = process.env): ProviderCredentialOptions {
  const forbiddenCredentialInputs = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  ];
  if (forbiddenCredentialInputs.some((name) => Boolean(env[name]?.trim()))) {
    throw new Error("database credential task-role configuration is invalid");
  }

  const options: ProviderCredentialOptions = {
    region: requiredEnv(env, "AWS_REGION"),
    credentialsRelativeUri: requiredEnv(env, "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"),
    masterSecretArn: requiredEnv(env, "HASNA_LOOPS_RDS_MASTER_SECRET_ARN"),
    migratorSecretArn: requiredEnv(env, "HASNA_LOOPS_MIGRATOR_DATABASE_URL_SECRET_ARN"),
    runtimeSecretArn: requiredEnv(env, "HASNA_LOOPS_RUNTIME_DATABASE_URL_SECRET_ARN"),
    authenticatorSecretArn: requiredEnv(env, "HASNA_LOOPS_AUTH_DATABASE_URL_SECRET_ARN"),
    expectedInstanceId: requiredEnv(env, "HASNA_LOOPS_RDS_INSTANCE_ID"),
    expectedEndpoint: requiredEnv(env, "HASNA_LOOPS_RDS_ENDPOINT"),
    expectedPort: Number(requiredEnv(env, "HASNA_LOOPS_RDS_PORT")),
    expectedDatabase: requiredEnv(env, "HASNA_LOOPS_RDS_DATABASE"),
    expectedMasterUsername: requiredEnv(env, "HASNA_LOOPS_RDS_MASTER_USERNAME"),
  };
  validateOptions(options);
  return options;
}

function validateOptions(options: ProviderCredentialOptions): void {
  const arns = [
    options.masterSecretArn,
    options.migratorSecretArn,
    options.runtimeSecretArn,
    options.authenticatorSecretArn,
  ];
  const arnParts = arns.map(parseSecretArn);
  if (
    !AWS_REGION.test(options.region) ||
    !ECS_CREDENTIALS_PATH.test(options.credentialsRelativeUri) ||
    arnParts.some((arn) => !arn) ||
    arnParts.some((arn) => arn?.region !== options.region) ||
    new Set(arnParts.map((arn) => arn?.partition)).size !== 1 ||
    new Set(arnParts.map((arn) => arn?.accountId)).size !== 1 ||
    new Set(arns).size !== arns.length ||
    !options.expectedInstanceId ||
    options.expectedInstanceId.length > 255 ||
    !isExpectedRdsEndpoint(options.expectedEndpoint, options.region, arnParts[0]?.partition) ||
    !Number.isInteger(options.expectedPort) ||
    options.expectedPort < 1 || options.expectedPort > 65535 ||
    !DATABASE_NAME.test(options.expectedDatabase) ||
    !IDENTIFIER.test(options.expectedMasterUsername)
  ) {
    throw new Error("database credential configuration is invalid");
  }
}

function parseSecretArn(arn: string): { partition: string; region: string; accountId: string } | undefined {
  if (!SECRET_ARN.test(arn)) return undefined;
  const parts = arn.split(":");
  return { partition: parts[1]!, region: parts[3]!, accountId: parts[4]! };
}

function isExpectedRdsEndpoint(host: string, region: string, partition: string | undefined): boolean {
  if (!RDS_ENDPOINT.test(host)) return false;
  const suffix = partition === "aws-cn"
    ? `.${region}.rds.amazonaws.com.cn`
    : `.${region}.rds.amazonaws.com`;
  return host.endsWith(suffix);
}

function parseMasterSecret(value: string, options: ProviderCredentialOptions): MasterSecret {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error("managed database secret is invalid");
  }
  const parsed = masterSecretSchema.safeParse(decoded);
  if (!parsed.success) throw new Error("managed database secret is invalid");
  const secret = parsed.data;
  if (
    secret.dbInstanceIdentifier !== options.expectedInstanceId ||
    secret.host !== options.expectedEndpoint ||
    secret.port !== options.expectedPort ||
    secret.dbname !== options.expectedDatabase ||
    secret.username !== options.expectedMasterUsername
  ) {
    throw new Error("managed database secret target is invalid");
  }
  return secret;
}

function buildDsn(input: { host: string; port: number; database: string; username: string; password: string }): string {
  const url = new URL("postgresql://placeholder/");
  url.username = input.username;
  url.password = input.password;
  url.hostname = input.host;
  url.port = String(input.port);
  url.pathname = `/${input.database}`;
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

function parsePurposeDsn(
  value: string,
  options: ProviderCredentialOptions,
  purpose: CredentialPurpose,
): { dsn: string; password: string } | undefined {
  try {
    const url = new URL(value);
    const expected = PROVIDER_CREDENTIAL_SPECS[purpose];
    if (
      url.protocol !== "postgresql:" ||
      url.hostname !== options.expectedEndpoint ||
      Number(url.port || "5432") !== options.expectedPort ||
      decodeURIComponent(url.pathname.slice(1)) !== options.expectedDatabase ||
      decodeURIComponent(url.username) !== expected.login ||
      !url.password ||
      url.searchParams.size !== 1 ||
      url.searchParams.get("sslmode") !== "verify-full" ||
      url.hash !== ""
    ) return undefined;
    return { dsn: value, password: decodeURIComponent(url.password) };
  } catch {
    return undefined;
  }
}

function generatedPassword(random: (bytes: number) => Uint8Array): string {
  const bytes = random(48);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 48) {
    throw new Error("database credential entropy source failed");
  }
  return Buffer.from(bytes).toString("base64url");
}

async function readSecretSafely(
  store: ProviderCredentialSecretStore,
  secretId: string,
  stage: SecretStage,
): Promise<SecretValue | undefined> {
  try {
    return await store.get(secretId, stage);
  } catch {
    throw new Error("database credential secret read failed");
  }
}

async function reconcileOne(
  purpose: CredentialPurpose,
  secretId: string,
  options: ProviderCredentialOptions,
  store: ProviderCredentialSecretStore,
  database: ProviderCredentialDatabase,
  random: (bytes: number) => Uint8Array,
  acceptedCurrentAttachments: readonly boolean[] = [false],
): Promise<ReconciledCredential> {
  const current = await readSecretSafely(store, secretId, "AWSCURRENT");
  const parsedCurrent = current ? parsePurposeDsn(current.value, options, purpose) : undefined;
  if (parsedCurrent) {
    for (const attached of acceptedCurrentAttachments) {
      const inspection = await database.inspectCredential(purpose, parsedCurrent.dsn, attached);
      if (inspection.valid) return { dsn: parsedCurrent.dsn, changed: false };
    }
  }

  const pending = await readSecretSafely(store, secretId, "AWSPENDING");
  const parsedPending = pending ? parsePurposeDsn(pending.value, options, purpose) : undefined;
  let candidate: SecretValue;
  let parsedCandidate: { dsn: string; password: string };
  if (pending && parsedPending) {
    candidate = pending;
    parsedCandidate = parsedPending;
  } else {
    const password = generatedPassword(random);
    const spec = PROVIDER_CREDENTIAL_SPECS[purpose];
    const dsn = buildDsn({
      host: options.expectedEndpoint,
      port: options.expectedPort,
      database: options.expectedDatabase,
      username: spec.login,
      password,
    });
    try {
      candidate = await store.putPending(secretId, dsn);
    } catch {
      throw new Error("database credential pending write failed");
    }
    parsedCandidate = { dsn, password };
  }

  let inspection = await database.inspectCredential(purpose, parsedCandidate.dsn, false);
  if (!inspection.valid) {
    await database.setPassword(purpose, parsedCandidate.password);
    inspection = await database.inspectCredential(purpose, parsedCandidate.dsn, false);
    if (!inspection.valid) throw new Error("database credential fresh connection failed");
  }

  try {
    await store.promote(secretId, candidate.versionId, current?.versionId);
  } catch {
    throw new Error("database credential promotion failed");
  }
  return { dsn: parsedCandidate.dsn, changed: true };
}

async function validCurrentCredentialDsn(
  purpose: CredentialPurpose,
  secretId: string,
  options: ProviderCredentialOptions,
  store: ProviderCredentialSecretStore,
  database: ProviderCredentialDatabase,
  attached: boolean,
): Promise<string | undefined> {
  const current = await readSecretSafely(store, secretId, "AWSCURRENT");
  const parsedCurrent = current ? parsePurposeDsn(current.value, options, purpose) : undefined;
  if (!parsedCurrent) return undefined;
  const inspection = await database.inspectCredential(purpose, parsedCurrent.dsn, attached);
  return inspection.valid ? parsedCurrent.dsn : undefined;
}

export async function reconcileProviderCredentials(
  options: ProviderCredentialOptions,
  dependencies: ProviderCredentialDependencies,
): Promise<ProviderCredentialResult> {
  validateOptions(options);
  const store = dependencies.secretStore ?? createAwsSecretStore(options);
  const masterValue = await readSecretSafely(store, options.masterSecretArn, "AWSCURRENT");
  if (!masterValue) throw new Error("managed database secret is unavailable");
  const master = parseMasterSecret(masterValue.value, options);
  const masterDsn = buildDsn({
    host: master.host,
    port: master.port,
    database: master.dbname,
    username: master.username,
    password: master.password,
  });
  const database = (dependencies.createDatabase ?? createNativeDatabase)(masterDsn, dependencies.bootstrapProbe);
  const random = dependencies.random ?? ((bytes: number) => randomBytes(bytes));
  let affectedSecrets = 0;
  try {
    // This gate intentionally precedes every service-secret read/write. It
    // catches PostgreSQL 16 implicit creator rows that RDS authority cannot
    // normalize, instead of publishing credentials for an unusable topology.
    await database.bootstrapBeforeSecrets();

    const migrator = await reconcileOne(
      "migrator", options.migratorSecretArn, options, store, database, random,
    );
    if (migrator.changed) affectedSecrets += 1;

    // The existing migration bootstrap probe exercises role normalization,
    // SET ROLE, ledger ownership/write, service-login cleanup, and rolls the
    // probe back. The exact 0010 ledger then selects the state machine phase.
    const phase = await database.probeMigrator(migrator.dsn);

    for (const purpose of ["runtime", "authenticator"] as const) {
      const secretId = options[PROVIDER_CREDENTIAL_SPECS[purpose].secretOption];
      const alreadyAttached = phase === "post_0010"
        ? await validCurrentCredentialDsn(purpose, secretId, options, store, database, true)
        : undefined;
      let reconciled: ReconciledCredential;
      if (alreadyAttached) {
        reconciled = { dsn: alreadyAttached, changed: false };
      } else {
        await database.detachService(purpose);
        reconciled = await reconcileOne(
          purpose,
          secretId,
          options,
          store,
          database,
          random,
          [false],
        );
      }
      if (reconciled.changed) affectedSecrets += 1;
      if (phase === "post_0010" && !alreadyAttached) {
        try {
          await database.attachService(purpose);
          const attached = await database.inspectCredential(purpose, reconciled.dsn, true);
          if (!attached.valid || !attached.enforcementApplied) {
            throw new Error("database credential service membership verification failed");
          }
        } catch {
          try {
            await database.detachService(purpose);
          } catch {
            throw new Error("database credential service membership rollback failed");
          }
          throw new Error("database credential service membership verification failed");
        }
      }
    }

    return {
      phase,
      status: "ok",
      invariants: {
        bootstrapNormalized: true,
        transportVerified: true,
        ledgerExact: true,
        serviceMembershipsSafe: true,
      },
      affectedSecrets,
    };
  } finally {
    try {
      await database.close();
    } catch {
      throw new Error("database credential cleanup failed");
    }
  }
}

export function logProviderCredentialSuccess(result: ProviderCredentialResult): void {
  console.log(JSON.stringify({ evt: "db_credentials_reconciled", ...result }));
}

export function createAwsSecretsManagerClientConfig(
  options: ProviderCredentialOptions,
  fetchImpl: ProviderCredentialFetch = fetch,
): SecretsManagerClientConfig {
  validateOptions(options);
  return {
    region: options.region,
    credentials: createEcsTaskRoleCredentialProvider(options, fetchImpl),
  };
}

function createEcsTaskRoleCredentialProvider(
  options: ProviderCredentialOptions,
  fetchImpl: ProviderCredentialFetch,
) {
  return async () => {
    let value: unknown;
    try {
      const response = await fetchImpl(`${ECS_CREDENTIALS_ORIGIN}${options.credentialsRelativeUri}`, {
        method: "GET",
        redirect: "error",
      });
      if (!response.ok) throw new Error("credential response rejected");
      value = await response.json();
    } catch {
      throw new Error("database credential task-role retrieval failed");
    }

    const parsed = ecsTaskRoleCredentialSchema.safeParse(value);
    if (!parsed.success) throw new Error("database credential task-role retrieval failed");
    const expiration = Date.parse(parsed.data.Expiration);
    if (!Number.isFinite(expiration) || expiration <= Date.now()) {
      throw new Error("database credential task-role retrieval failed");
    }
    return {
      accessKeyId: parsed.data.AccessKeyId,
      secretAccessKey: parsed.data.SecretAccessKey,
      sessionToken: parsed.data.Token,
      expiration: new Date(expiration),
    };
  };
}

function createAwsSecretStore(options: ProviderCredentialOptions): ProviderCredentialSecretStore {
  const client = new SecretsManagerClient(createAwsSecretsManagerClientConfig(options));
  return {
    get: async (secretId, stage) => {
      try {
        const result = await client.send(new GetSecretValueCommand({ SecretId: secretId, VersionStage: stage }));
        if (!result.SecretString || !result.VersionId) throw new Error("missing secret material");
        return { value: result.SecretString, versionId: result.VersionId };
      } catch (error) {
        if (error && typeof error === "object" && "name" in error && error.name === "ResourceNotFoundException") {
          return undefined;
        }
        throw error;
      }
    },
    putPending: async (secretId, value) => {
      const token = randomUUID();
      const result = await client.send(new PutSecretValueCommand({
        SecretId: secretId,
        SecretString: value,
        ClientRequestToken: token,
        VersionStages: ["AWSPENDING"],
      }));
      if (!result.VersionId) throw new Error("missing pending version");
      return { value, versionId: result.VersionId };
    },
    promote: async (secretId, pendingVersionId, currentVersionId) => {
      await client.send(new UpdateSecretVersionStageCommand({
        SecretId: secretId,
        VersionStage: "AWSCURRENT",
        MoveToVersionId: pendingVersionId,
        ...(currentVersionId ? { RemoveFromVersionId: currentVersionId } : {}),
      }));
    },
  };
}

const PROVIDER_BOOTSTRAP_LOGINS_SQL = `
DO $provider_logins$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_migrator_login') THEN
    CREATE ROLE open_loops_migrator_login LOGIN INHERIT NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE open_loops_migrator_login LOGIN INHERIT NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_runtime_login') THEN
    CREATE ROLE open_loops_runtime_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE open_loops_runtime_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='open_loops_authenticator_login') THEN
    CREATE ROLE open_loops_authenticator_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    ALTER ROLE open_loops_authenticator_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$provider_logins$;
`.trim();

export const PROVIDER_BOOTSTRAP_MEMBERSHIPS_SQL = `
DO $provider_memberships$
DECLARE membership RECORD;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role
      FROM pg_auth_members relation
      JOIN pg_roles granted ON granted.oid=relation.roleid
      JOIN pg_roles member ON member.oid=relation.member
     WHERE (
       member.rolname IN (
         'open_loops_migrator_login',
         'open_loops_runtime_login',
         'open_loops_authenticator_login'
       )
       OR (
         member.rolname=session_user
         AND granted.rolname IN (
           'open_loops_owner', 'open_loops_migrator',
           'open_loops_runtime', 'open_loops_authenticator'
         )
       )
     )
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
  GRANT open_loops_owner, open_loops_migrator TO open_loops_migrator_login
    WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
END
$provider_memberships$;
`.trim();

export const PROVIDER_BOOTSTRAP_INVARIANT_SQL = `
WITH expected(member_role, granted_role) AS (
  VALUES
    ('open_loops_migrator_login', 'open_loops_owner'),
    ('open_loops_migrator_login', 'open_loops_migrator')
), bad_membership AS (
  SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_roles member ON member.oid=membership.member
   WHERE (
     member.rolname IN (
       'open_loops_migrator_login',
       'open_loops_runtime_login',
       'open_loops_authenticator_login'
     )
     OR (
       member.rolname = session_user
       AND granted.rolname IN (
         'open_loops_owner', 'open_loops_migrator',
         'open_loops_runtime', 'open_loops_authenticator'
       )
     )
   )
     AND NOT EXISTS (
       SELECT 1 FROM expected
        WHERE expected.member_role = member.rolname
          AND expected.granted_role = granted.rolname
          AND NOT membership.admin_option
          AND membership.inherit_option
          AND membership.set_option
   )
), missing_membership AS (
  SELECT 1 FROM expected
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_auth_members membership
       JOIN pg_roles granted ON granted.oid=membership.roleid
       JOIN pg_roles member ON member.oid=membership.member
      WHERE member.rolname=expected.member_role
        AND granted.rolname=expected.granted_role
        AND NOT membership.admin_option
        AND membership.inherit_option
        AND membership.set_option
   )
)
SELECT NOT EXISTS (SELECT 1 FROM bad_membership)
   AND NOT EXISTS (SELECT 1 FROM missing_membership) AS safe
`.trim();

class NativeProviderCredentialDatabase implements ProviderCredentialDatabase {
  constructor(
    private readonly master: PgPoolExecutor,
    private readonly probe: BootstrapProbe,
  ) {}

  async bootstrapBeforeSecrets(): Promise<void> {
    try {
      await this.master.queryClient.transaction(async (transaction) => {
        await transaction.execute(POSTGRES_MIGRATION_ADVISORY_LOCK_SQL);
        await transaction.execute(POSTGRES_TENANT_BOOTSTRAP_ROLES_SQL);
        await transaction.execute(POSTGRES_TENANT_CLUSTER_ROLE_EXCLUSIVITY_SQL);
        await transaction.execute(PROVIDER_BOOTSTRAP_LOGINS_SQL);
        await transaction.execute(PROVIDER_BOOTSTRAP_MEMBERSHIPS_SQL);
        const safe = await transaction.get<{ safe: boolean }>(PROVIDER_BOOTSTRAP_INVARIANT_SQL);
        if (!safe?.safe) throw new Error("membership invariant failed");
        const databaseOwner = await transaction.get<{ statement: string }>(
          "SELECT format('ALTER DATABASE %I OWNER TO open_loops_migrator_login', current_database()) AS statement",
        );
        if (!databaseOwner?.statement) throw new Error("database owner statement unavailable");
        await transaction.execute(databaseOwner.statement);
        await transaction.execute("ALTER SCHEMA public OWNER TO open_loops_migrator_login");
      });
    } catch {
      throw new Error("database credential bootstrap normalization failed");
    }
  }

  async setPassword(purpose: CredentialPurpose, password: string): Promise<void> {
    const login = PROVIDER_CREDENTIAL_SPECS[purpose].login;
    try {
      await this.master.queryClient.transaction(async (transaction) => {
        const statement = await transaction.get<{ statement: string }>(
          "SELECT format('ALTER ROLE %I PASSWORD %L', $1, $2) AS statement",
          [login, password],
        );
        if (!statement?.statement) throw new Error("password statement unavailable");
        await transaction.execute(statement.statement);
      });
    } catch {
      throw new Error("database credential password update failed");
    }
  }

  async inspectCredential(
    purpose: CredentialPurpose,
    dsn: string,
    attached: boolean,
  ): Promise<CredentialInspection> {
    const executor = PgPoolExecutor.fromConnectionString({
      connectionString: dsn,
      applicationName: "loops-db-credential-verify",
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 1_000,
    });
    try {
      const expected = PROVIDER_CREDENTIAL_SPECS[purpose];
      const row = await executor.queryClient.get<{
        session_user: string;
        rolcanlogin: boolean;
        rolinherit: boolean;
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolreplication: boolean;
        rolbypassrls: boolean;
        membership_count: string | number;
        expected_memberships: boolean;
        enforcement_applied: boolean;
      }>(
        `SELECT session_user,
                login.rolcanlogin, login.rolinherit, login.rolsuper,
                login.rolcreatedb, login.rolcreaterole,
                login.rolreplication, login.rolbypassrls,
                (SELECT count(*) FROM pg_auth_members direct WHERE direct.member=login.oid) AS membership_count,
                CASE
                  WHEN $1='migrator' THEN
                    (SELECT count(*)=2
                       FROM pg_auth_members direct
                       JOIN pg_roles granted ON granted.oid=direct.roleid
                      WHERE direct.member=login.oid
                        AND granted.rolname IN ('open_loops_owner', 'open_loops_migrator')
                        AND NOT direct.admin_option AND direct.inherit_option AND direct.set_option)
                  WHEN $3 THEN
                    EXISTS (
                      SELECT 1 FROM pg_auth_members direct
                      JOIN pg_roles granted ON granted.oid=direct.roleid
                       WHERE direct.member=login.oid AND granted.rolname=$2
                         AND NOT direct.admin_option AND direct.inherit_option AND direct.set_option
                    )
                  ELSE (SELECT count(*)=0 FROM pg_auth_members direct WHERE direct.member=login.oid)
                END AS expected_memberships,
                EXISTS (
                  SELECT 1 FROM open_loops_schema_migrations
                   WHERE id=$4 AND checksum=$5
                ) AS enforcement_applied
           FROM pg_roles login
          WHERE login.rolname=session_user`,
        [purpose, purpose === "runtime" ? "open_loops_runtime" : "open_loops_authenticator", attached,
          TENANT_ENFORCEMENT_MIGRATION_ID, tenantEnforcementChecksum()],
      );
      const count = Number(row?.membership_count ?? -1);
      const base = Boolean(
        row && row.session_user === expected.login && row.rolcanlogin && row.rolinherit &&
        !row.rolsuper && !row.rolcreatedb && !row.rolreplication && !row.rolbypassrls &&
        row.expected_memberships,
      );
      const roleShape = purpose === "migrator"
        ? row?.rolcreaterole === true && count === 2
        : row?.rolcreaterole === false && count === (attached ? 1 : 0);
      return { valid: base && roleShape, enforcementApplied: row?.enforcement_applied === true };
    } catch {
      return { valid: false, enforcementApplied: false };
    } finally {
      await executor.close().catch(() => undefined);
    }
  }

  async probeMigrator(dsn: string): Promise<CredentialPhase> {
    const executor = PgPoolExecutor.fromConnectionString({
      connectionString: dsn,
      applicationName: "loops-db-credential-probe",
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 1_000,
    });
    try {
      const schema = new PostgresStorage(executor);
      await this.probe(executor.queryClient, schema);
      const row = await executor.queryClient.get<{ checksum: string }>(
        "SELECT checksum FROM open_loops_schema_migrations WHERE id=$1",
        [TENANT_ENFORCEMENT_MIGRATION_ID],
      );
      if (!row) return "pre_0010";
      if (row.checksum !== tenantEnforcementChecksum()) {
        throw new Error("database credential enforcement ledger mismatch");
      }
      return "post_0010";
    } catch (error) {
      if (error instanceof Error && error.message === "database credential enforcement ledger mismatch") throw error;
      throw new Error("database credential bootstrap probe failed");
    } finally {
      await executor.close().catch(() => undefined);
    }
  }

  async attachService(purpose: ServicePurpose): Promise<void> {
    await this.setServiceMembership(purpose, true);
  }

  async detachService(purpose: ServicePurpose): Promise<void> {
    await this.setServiceMembership(purpose, false);
  }

  private async setServiceMembership(purpose: ServicePurpose, attach: boolean): Promise<void> {
    const login = PROVIDER_CREDENTIAL_SPECS[purpose].login;
    const role = PROVIDER_CREDENTIAL_SPECS[purpose].role;
    try {
      await this.master.queryClient.transaction(async (transaction) => {
        const memberships = await transaction.many<{ granted_role: string }>(
          `SELECT granted.rolname AS granted_role
             FROM pg_auth_members direct
             JOIN pg_roles granted ON granted.oid=direct.roleid
             JOIN pg_roles member ON member.oid=direct.member
            WHERE member.rolname=$1`,
          [login],
        );
        for (const membership of memberships) {
          const statement = await transaction.get<{ statement: string }>(
            "SELECT format('REVOKE %I FROM %I', $1, $2) AS statement",
            [membership.granted_role, login],
          );
          if (!statement?.statement) throw new Error("membership statement unavailable");
          await transaction.execute(statement.statement);
        }
        if (attach) {
          const statement = await transaction.get<{ statement: string }>(
            "SELECT format('GRANT %I TO %I WITH ADMIN FALSE, INHERIT TRUE, SET TRUE', $1, $2) AS statement",
            [role, login],
          );
          if (!statement?.statement) throw new Error("membership statement unavailable");
          await transaction.execute(statement.statement);
        }
      });
    } catch {
      throw new Error(attach
        ? "database credential service membership attach failed"
        : "database credential service membership detach failed");
    }
  }

  async close(): Promise<void> {
    await this.master.close();
  }
}

function tenantEnforcementChecksum(): string {
  const migration = POSTGRES_STORAGE_MIGRATIONS.find((item) => item.id === TENANT_ENFORCEMENT_MIGRATION_ID);
  if (!migration) throw new Error("database credential enforcement migration unavailable");
  return migration.checksum;
}

function createNativeDatabase(masterDsn: string, probe: BootstrapProbe): ProviderCredentialDatabase {
  return new NativeProviderCredentialDatabase(PgPoolExecutor.fromConnectionString({
    connectionString: masterDsn,
    applicationName: "loops-db-credential-bootstrap",
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 1_000,
  }), probe);
}
