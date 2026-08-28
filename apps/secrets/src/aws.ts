import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  DescribeSecretCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  UpdateSecretVersionStageCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { fromIni, fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { parseKnownFiles, type Profile } from "@smithy/core/config";
import { randomUUID } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { dirname, join } from "path";
import { ensureOperatorDataDir } from "./data-dir.js";
import { getStore } from "./store/index.js";
import {
  assertTestVaultPathAllowed,
  isTestVaultRedirectContext,
  SecretsTestIsolationError,
  testVaultDir,
} from "./test-isolation.js";
import type { AwsConfig, AwsCredentialMode, SecretMetadata } from "./types.js";

type AwsClient = Pick<SecretsManagerClient, "send">;
type AwsClientFactory = (config: ResolvedAwsConfig) => AwsClient;

export interface AwsCommandOptions {
  credentialMode?: AwsCredentialMode;
  region?: string;
  prefix?: string;
  profile?: string;
  roleArn?: string;
  sourceProfile?: string;
  externalId?: string;
  sessionName?: string;
  dryRun?: boolean;
  /** The reviewed AWSCURRENT version required before replacing a remote value. */
  expectedVersionId?: string;
}

export interface ResolvedAwsConfig {
  credentialMode: AwsCredentialMode;
  credentialSource: "static" | "default" | "profile" | "role";
  region: string;
  prefix?: string;
  profile?: string;
  roleArn?: string;
  sourceProfile?: string;
  externalId?: string;
  sessionName?: string;
  staticCredentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

export interface AwsPlanAction {
  action: "push" | "pull" | "list-remote" | "noop" | "conflict";
  key?: string;
  awsName?: string;
  localState?: "exists" | "missing" | "not-checked";
  remoteState?: "exists" | "missing" | "not-checked" | "unknown";
  mutation: "none" | "aws-write" | "local-write";
  localUpdatedAt?: string;
  remoteVersionId?: string;
  baselineLocalUpdatedAt?: string;
  baselineRemoteVersionId?: string;
  note: string;
}

export interface AwsPlanResult {
  dryRun: true;
  operation: "push" | "pull" | "sync";
  config: AwsConfigSummary;
  actions: AwsPlanAction[];
  errors: string[];
}

export interface AwsSyncResult {
  pushed: string[];
  pulled: string[];
  conflicts: AwsSyncConflict[];
  errors: string[];
  plan?: AwsPlanResult;
}

export interface AwsSyncConflict {
  key: string;
  awsName: string;
  localUpdatedAt?: string;
  remoteVersionId?: string;
  baselineLocalUpdatedAt?: string;
  baselineRemoteVersionId?: string;
  note: string;
}

export interface AwsConfigSummary {
  credentialMode: AwsCredentialMode;
  credentialSource: ResolvedAwsConfig["credentialSource"];
  region: string;
  prefix?: string;
  profile?: string;
  roleArn?: string;
  sourceProfile?: string;
  sessionName?: string;
}

export interface AwsAccountProfile {
  profile: string;
  region?: string;
}

export type AwsProfileMap = Record<string, Profile>;

let clientFactory: AwsClientFactory = (config) => makeDefaultClient(config);

const SYNC_STATE_VERSION = 1;
const SYNC_PENDING_STAGE = "HASNA_SYNC_PENDING";

interface AwsSyncCheckpoint {
  key: string;
  awsName: string;
  localUpdatedAt: string;
  remoteVersionId: string;
  reconciledAt: string;
}

interface AwsSyncState {
  version: typeof SYNC_STATE_VERSION;
  entries: Record<string, AwsSyncCheckpoint>;
}

interface RemoteSecretMetadata {
  name: string;
  arn?: string;
  versionId?: string;
}

function getAwsConfigPath(): string {
  const dir = isTestVaultRedirectContext() ? testVaultDir() : ensureOperatorDataDir();
  return join(dir, "aws.json");
}

export function loadAwsConfig(): AwsConfig | null {
  const path = getAwsConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AwsConfig;
  } catch {
    return null;
  }
}

export function saveAwsConfig(config: AwsConfig): void {
  const path = getAwsConfigPath();
  const dir = join(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function getAwsSyncStatePath(): string {
  const override = process.env.HASNA_SECRETS_AWS_SYNC_STATE?.trim();
  if (override) {
    assertTestVaultPathAllowed(override);
    return override;
  }
  if (isTestVaultRedirectContext()) return join(testVaultDir(), "aws-sync-state.json");
  return join(ensureOperatorDataDir(), "aws-sync-state.json");
}

function emptyAwsSyncState(): AwsSyncState {
  return { version: SYNC_STATE_VERSION, entries: {} };
}

function loadAwsSyncState(): AwsSyncState {
  const path = getAwsSyncStatePath();
  if (!existsSync(path)) return emptyAwsSyncState();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<AwsSyncState>;
    if (parsed.version !== SYNC_STATE_VERSION || !parsed.entries || typeof parsed.entries !== "object") {
      return emptyAwsSyncState();
    }
    return { version: SYNC_STATE_VERSION, entries: parsed.entries };
  } catch {
    // A missing or damaged baseline must fail closed: overlapping keys will be
    // reported as unreconciled conflicts instead of either side being overwritten.
    return emptyAwsSyncState();
  }
}

function saveAwsSyncState(state: AwsSyncState): void {
  const path = getAwsSyncStatePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
  chmodSync(path, 0o600);
}

function remoteIdentity(config: ResolvedAwsConfig, name: string, arn?: string): string {
  return arn ?? `${config.region}:${name}`;
}

function recordCheckpoint(
  config: ResolvedAwsConfig,
  remote: { name: string; arn?: string; versionId: string },
  local: SecretMetadata,
): void {
  const state = loadAwsSyncState();
  state.entries[remoteIdentity(config, remote.name, remote.arn)] = {
    key: local.key,
    awsName: remote.name,
    localUpdatedAt: local.updated_at,
    remoteVersionId: remote.versionId,
    reconciledAt: new Date().toISOString(),
  };
  saveAwsSyncState(state);
}

/**
 * The production factory. Exported so a caller that genuinely wants the real AWS
 * client back after a test has to name it, rather than reaching it by omission.
 */
export const defaultAwsClientFactory: AwsClientFactory = (config) => makeDefaultClient(config);

/**
 * A factory that refuses. This is what {@link setAwsClientFactoryForTests} installs
 * when called with no argument, so "reset" means "no AWS client at all" rather than
 * "the real one".
 */
const refusingAwsClientFactory: AwsClientFactory = () => {
  throw new SecretsTestIsolationError(
    "Test isolation: no AWS client is installed. setAwsClientFactoryForTests() with no " +
      "argument resets to a REFUSING factory, not the real AWS SDK client — a test that " +
      "reaches AWS must install its own fake, and a test that forgot must fail rather " +
      "than call out. Pass defaultAwsClientFactory explicitly if a real client is wanted.",
  );
};

/**
 * Swap the AWS client used by pushSecret/syncAll.
 *
 * WITH NO ARGUMENT THIS DOES NOT RESTORE THE REAL CLIENT. It installs a refusing
 * factory. The previous behaviour — reset-to-real — meant every `beforeEach` in the
 * suite re-armed a live AWS client and the suite stayed offline only because all four
 * call sites happened to install a fake before using one. That is convention holding
 * the line, one forgotten line from a real API call, and convention is the exact
 * thing HC-00304 proved does not hold.
 */
export function setAwsClientFactoryForTests(factory?: AwsClientFactory): void {
  clientFactory = factory ?? refusingAwsClientFactory;
}

export function resolveAwsConfig(
  options: AwsCommandOptions = {},
  storedConfig: AwsConfig | null = loadAwsConfig()
): ResolvedAwsConfig {
  const stored = storedConfig ?? {};
  const staticCredentials = getStaticCredentials(stored);
  const explicitProfile = first(options.profile, process.env.HASNA_SECRETS_AWS_PROFILE);
  const storedProfile = stored.profile;
  const ambientProfile = process.env.AWS_PROFILE;
  const candidateProfile = first(explicitProfile, storedProfile, ambientProfile);
  const roleArn = first(options.roleArn, process.env.HASNA_SECRETS_AWS_ROLE_ARN, stored.role_arn);
  const mode =
    normalizeCredentialMode(
      first(options.credentialMode, process.env.HASNA_SECRETS_AWS_CREDENTIAL_MODE, stored.credential_mode)
    ) ?? inferCredentialMode({ roleArn, explicitProfile, storedProfile, profile: candidateProfile, staticCredentials });
  const profile = mode === "profile" ? candidateProfile : undefined;
  const sourceProfile =
    mode === "role"
      ? first(
          options.sourceProfile,
          process.env.HASNA_SECRETS_AWS_SOURCE_PROFILE,
          stored.source_profile,
          explicitProfile,
          storedProfile
        )
      : undefined;

  if (mode === "static" && !staticCredentials) {
    throw new Error("AWS static credential mode requires access_key_id and secret_access_key");
  }
  if (mode === "profile" && !profile) {
    throw new Error("AWS profile credential mode requires --profile, HASNA_SECRETS_AWS_PROFILE, AWS_PROFILE, or aws.json profile");
  }
  if (mode === "role" && !roleArn) {
    throw new Error("AWS role credential mode requires --role-arn, HASNA_SECRETS_AWS_ROLE_ARN, or aws.json role_arn");
  }

  return {
    credentialMode: mode,
    credentialSource: mode,
    region: first(
      options.region,
      process.env.HASNA_SECRETS_AWS_REGION,
      stored.region,
      process.env.AWS_REGION,
      process.env.AWS_DEFAULT_REGION
    ) ?? "us-east-1",
    prefix: first(options.prefix, process.env.HASNA_SECRETS_AWS_PREFIX, stored.prefix),
    ...(profile ? { profile } : {}),
    ...(roleArn ? { roleArn } : {}),
    ...(sourceProfile ? { sourceProfile } : {}),
    ...(first(options.externalId, process.env.HASNA_SECRETS_AWS_EXTERNAL_ID, stored.external_id)
      ? { externalId: first(options.externalId, process.env.HASNA_SECRETS_AWS_EXTERNAL_ID, stored.external_id) }
      : {}),
    sessionName:
      first(options.sessionName, process.env.HASNA_SECRETS_AWS_SESSION_NAME, stored.session_name) ??
      "open-secrets-sync",
    ...(staticCredentials ? { staticCredentials } : {}),
  };
}

export function summarizeAwsConfig(config: ResolvedAwsConfig): AwsConfigSummary {
  return {
    credentialMode: config.credentialMode,
    credentialSource: config.credentialSource,
    region: config.region,
    ...(config.prefix ? { prefix: config.prefix } : {}),
    ...(config.profile ? { profile: config.profile } : {}),
    ...(config.roleArn ? { roleArn: config.roleArn } : {}),
    ...(config.sourceProfile ? { sourceProfile: config.sourceProfile } : {}),
    ...(config.sessionName ? { sessionName: config.sessionName } : {}),
  };
}

/**
 * Load standard AWS config and credentials through the same normalized parser
 * used by the AWS credential provider. AWS_CONFIG_FILE and
 * AWS_SHARED_CREDENTIALS_FILE remain the source of truth.
 */
export async function loadAwsProfiles(): Promise<AwsProfileMap> {
  return parseKnownFiles({ ignoreCache: true });
}

/** Resolve a provider source profile plus account to one configured profile. */
export function resolveAwsAccountProfile(
  provider: string,
  account: string,
  profiles: AwsProfileMap,
): AwsAccountProfile {
  const normalizedProvider = provider.trim();
  const normalizedAccount = account.trim();
  if (!normalizedProvider) throw new Error("AWS provider profile must not be empty");
  if (!/^\d{12}$/.test(normalizedAccount)) {
    throw new Error(`Invalid AWS account "${normalizedAccount}"; expected a 12-digit account ID`);
  }

  const matches = Object.entries(profiles).filter(([profileName, profile]) => {
    const roleAccount = profile.role_arn?.match(/^arn:[^:]+:iam::(\d{12}):role\/.+$/)?.[1];
    const profileAccount = roleAccount ?? profile.sso_account_id ?? profile.account_id;
    if (profileAccount !== normalizedAccount) return false;
    return profileName === normalizedProvider ||
      profile.source_profile === normalizedProvider ||
      profile.sso_session === normalizedProvider;
  });

  if (matches.length === 0) {
    throw new Error(
      `No AWS profile configured for provider "${normalizedProvider}" and account "${normalizedAccount}"`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple AWS profiles match provider "${normalizedProvider}" and account "${normalizedAccount}": ` +
      matches.map(([profileName]) => profileName).sort().join(", "),
    );
  }

  const [profileName, profile] = matches[0];
  return {
    profile: profileName,
    ...(profile.region ? { region: profile.region } : {}),
  };
}

function normalizeAwsEnvPart(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Resolve one environment selector to a remote secret name without touching AWS.
 *
 * Canonical provider secrets use `<provider>/oss/<workload>/<key>`, exposed as
 * `<PROVIDER>_<WORKLOAD>_<KEY>`. Every remaining path segment participates in
 * normalization, so aliases that collapse to the same environment name are
 * rejected rather than selected by list order. A literal remote name remains a
 * supported selector and takes precedence over canonical-name derivation.
 */
export function resolveAwsEnvSecretName(
  provider: string,
  envName: string,
  remoteNames: readonly string[],
): string {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedEnvName = envName.trim();
  if (!normalizedProvider) throw new Error("AWS provider must not be empty");
  if (!normalizedEnvName) throw new Error("AWS environment selector must not be empty");

  const names = [...new Set(remoteNames.map((name) => name.trim()).filter(Boolean))];
  if (names.includes(normalizedEnvName)) return normalizedEnvName;

  const matches = names.filter((name) => {
    const segments = name.split("/");
    if (segments.length < 4 || segments[0] !== normalizedProvider || segments[1] !== "oss") {
      return false;
    }
    const envSegments = [normalizedProvider, ...segments.slice(2)].map(normalizeAwsEnvPart);
    return envSegments.every(Boolean) && envSegments.join("_") === normalizedEnvName;
  });

  if (matches.length === 0) {
    throw new Error(
      `No AWS secret maps to environment variable "${normalizedEnvName}" for provider "${normalizedProvider}"`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple AWS secrets map to environment variable "${normalizedEnvName}" for provider ` +
      `"${normalizedProvider}"; refusing an ambiguous selection`,
    );
  }
  return matches[0];
}

async function readAwsStringSecretValue(
  client: AwsClient,
  secretId: string,
  envName: string,
  versionId?: string,
): Promise<string> {
  const result = await client.send(new GetSecretValueCommand({
    SecretId: secretId,
    VersionStage: "AWSCURRENT",
    ...(versionId ? { VersionId: versionId } : {}),
  }));
  if (typeof result.SecretString !== "string") {
    throw new Error(
      `AWS secret selected for environment variable "${envName}" has no string AWSCURRENT value`,
    );
  }
  return result.SecretString;
}

/** Resolve a provider-scoped environment selector and read one AWSCURRENT string. */
export async function getAwsSecretValueForEnv(
  provider: string,
  envName: string,
  options: AwsCommandOptions = {},
): Promise<string> {
  const normalizedEnvName = envName.trim();
  if (!normalizedEnvName) throw new Error("AWS environment selector must not be empty");
  const config = resolveAwsConfig(options);
  const client = clientFactory(config);

  // Preserve the 0.2.19 direct-name contract without requiring ListSecrets.
  // Only a definite not-found result falls back to canonical metadata lookup;
  // access, transport, decoding, and non-string failures remain fatal.
  try {
    return await readAwsStringSecretValue(client, normalizedEnvName, normalizedEnvName);
  } catch (error) {
    if (!isResourceNotFound(error)) throw error;
  }

  const remote: RemoteSecretMetadata[] = [];
  const seenTokens = new Set<string>();
  let nextToken: string | undefined;
  do {
    let result;
    try {
      result = await client.send(new ListSecretsCommand({ NextToken: nextToken, MaxResults: 100 }));
    } catch (error) {
      throw new Error(
        `Unable to list AWS secret metadata for environment variable "${normalizedEnvName}"`,
        { cause: error },
      );
    }
    for (const secret of result.SecretList ?? []) {
      if (!secret.Name) continue;
      const versionId = currentVersionId(secret.SecretVersionsToStages);
      remote.push({
        name: secret.Name,
        ...(secret.ARN ? { arn: secret.ARN } : {}),
        ...(versionId ? { versionId } : {}),
      });
    }
    nextToken = result.NextToken;
    if (nextToken) {
      if (seenTokens.has(nextToken)) {
        throw new Error(
          `AWS secret metadata pagination repeated for environment variable "${normalizedEnvName}"`,
        );
      }
      seenTokens.add(nextToken);
    }
  } while (nextToken);

  const secretName = resolveAwsEnvSecretName(
    provider,
    normalizedEnvName,
    remote.map(({ name }) => name),
  );
  const selected = remote.find(({ name }) => name === secretName)!;
  if (!selected.versionId) {
    throw new Error(
      `AWS secret selected for environment variable "${normalizedEnvName}" has no AWSCURRENT version`,
    );
  }
  try {
    return await readAwsStringSecretValue(
      client,
      selected.arn ?? selected.name,
      normalizedEnvName,
      selected.versionId,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("has no string AWSCURRENT value")) {
      throw error;
    }
    throw new Error(
      `Unable to read AWS secret selected for environment variable "${normalizedEnvName}"`,
      { cause: error },
    );
  }
}

/** Read one exact AWSCURRENT string value without mutating the local vault. */
export async function getAwsSecretValue(
  secretId: string,
  options: AwsCommandOptions = {},
): Promise<string> {
  const normalizedSecretId = secretId.trim();
  if (!normalizedSecretId) throw new Error("AWS secret ID must not be empty");
  const config = resolveAwsConfig(options);
  const client = clientFactory(config);
  const result = await client.send(new GetSecretValueCommand({
    SecretId: normalizedSecretId,
    VersionStage: "AWSCURRENT",
  }));
  if (!result.SecretString) {
    throw new Error(`No string value for AWS secret: ${normalizedSecretId}`);
  }
  return result.SecretString;
}

function isResourceNotFound(error: unknown): boolean {
  return error instanceof ResourceNotFoundException ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "ResourceNotFoundException");
}

function currentVersionId(stages?: Record<string, string[]>): string | undefined {
  return Object.entries(stages ?? {}).find(([, labels]) => labels.includes("AWSCURRENT"))?.[0];
}

async function describeRemoteSecret(
  client: AwsClient,
  secretId: string,
): Promise<RemoteSecretMetadata | undefined> {
  try {
    const result = await client.send(new DescribeSecretCommand({ SecretId: secretId }));
    return {
      name: result.Name ?? secretId,
      ...(result.ARN ? { arn: result.ARN } : {}),
      ...(currentVersionId(result.VersionIdsToStages) ?
        { versionId: currentVersionId(result.VersionIdsToStages) } : {}),
    };
  } catch (error) {
    if (isResourceNotFound(error)) return undefined;
    throw error;
  }
}

function requireRemoteVersion(remote: RemoteSecretMetadata): string {
  if (!remote.versionId) {
    throw new Error(`AWS secret ${remote.name} has no AWSCURRENT version; refusing to reconcile it`);
  }
  return remote.versionId;
}

async function createRemoteSecret(
  key: string,
  config: ResolvedAwsConfig,
  client: AwsClient,
): Promise<void> {
  const entry = await getStore().getSecret(key);
  if (!entry) throw new Error(`Secret not found: ${key}`);
  const name = awsName(key, config.prefix);
  const result = await client.send(
    new CreateSecretCommand({
      Name: name,
      SecretString: entry.value,
      ClientRequestToken: randomUUID(),
      Description: entry.label ?? `Managed by open-secrets (type: ${entry.type})`,
      Tags: [
        { Key: "open-secrets-key", Value: key },
        { Key: "open-secrets-type", Value: entry.type },
      ],
    })
  );
  if (!result.VersionId) {
    throw new Error(`AWS did not return a version for newly created secret ${name}`);
  }
  recordCheckpoint(config, {
    name,
    ...(result.ARN ? { arn: result.ARN } : {}),
    versionId: result.VersionId,
  }, entry);
}

async function replaceRemoteSecret(
  entry: Awaited<ReturnType<ReturnType<typeof getStore>["getSecret"]>> & {},
  remote: RemoteSecretMetadata,
  expectedVersionId: string,
  client: AwsClient,
): Promise<{ arn?: string; versionId: string }> {
  const token = randomUUID();
  const secretId = remote.arn ?? remote.name;
  const staged = await client.send(
    new PutSecretValueCommand({
      SecretId: secretId,
      SecretString: entry.value,
      ClientRequestToken: token,
      VersionStages: [SYNC_PENDING_STAGE],
    })
  );
  const versionId = staged.VersionId ?? token;

  try {
    await client.send(
      new UpdateSecretVersionStageCommand({
        SecretId: secretId,
        VersionStage: "AWSCURRENT",
        MoveToVersionId: versionId,
        RemoveFromVersionId: expectedVersionId,
      })
    );
  } catch (error) {
    // The reviewed version changed before promotion. The staged value never became
    // AWSCURRENT; remove its temporary label when possible and preserve the conflict.
    try {
      await client.send(
        new UpdateSecretVersionStageCommand({
          SecretId: secretId,
          VersionStage: SYNC_PENDING_STAGE,
          RemoveFromVersionId: versionId,
        })
      );
    } catch {}
    throw error;
  }

  // Promotion succeeded. Failure to remove the auxiliary label is harmless: the
  // value is already current and a later staged write will move this unique label.
  try {
    await client.send(
      new UpdateSecretVersionStageCommand({
        SecretId: secretId,
        VersionStage: SYNC_PENDING_STAGE,
        RemoveFromVersionId: versionId,
      })
    );
  } catch {}

  return {
    ...(staged.ARN ?? remote.arn ? { arn: staged.ARN ?? remote.arn } : {}),
    versionId,
  };
}

export async function pushSecret(
  key: string,
  options: AwsCommandOptions = {}
): Promise<AwsPlanResult | undefined> {
  const config = resolveAwsConfig(options);
  const name = awsName(key, config.prefix);
  const metadata = await getLocalMetadata(key);
  if (!metadata) throw new Error(`Secret not found: ${key}`);

  // Planning is offline by contract: a single-key plan reads local metadata only
  // and sends no AWS command, so `--dry-run` stays safe to run against production
  // and needs no live credentials. The version reconciliation below is enforced on
  // the live path, which is where a value can actually be replaced.
  if (options.dryRun) {
    return planResult("push", config, [{
      action: "push",
      key,
      awsName: name,
      localState: "exists",
      remoteState: "not-checked",
      mutation: "none",
      localUpdatedAt: metadata.updated_at,
      ...(options.expectedVersionId ? { remoteVersionId: options.expectedVersionId } : {}),
      note: options.expectedVersionId
        ? "Would replace AWSCURRENT only if it is still the reviewed version at execution time; otherwise the push is refused."
        : "Would create the AWS secret if it is missing. If it already exists the push is refused until you review its version and retry with --expect-version.",
    }]);
  }

  const client = clientFactory(config);
  const remote = await describeRemoteSecret(client, name);
  if (!remote) {
    await createRemoteSecret(key, config, client);
    return;
  }
  const versionId = requireRemoteVersion(remote);
  if (!options.expectedVersionId) {
    throw new Error(
      `AWS secret ${name} already exists at version ${versionId}; review it with --dry-run and retry with --expect-version ${versionId}`
    );
  }
  if (options.expectedVersionId !== versionId) {
    throw new Error(
      `AWS secret ${name} changed: expected ${options.expectedVersionId}, current ${versionId}; refusing to overwrite it`
    );
  }
  const entry = await getStore().getSecret(key);
  if (!entry) throw new Error(`Secret not found: ${key}`);
  const replaced = await replaceRemoteSecret(entry, remote, versionId, client);
  recordCheckpoint(config, {
    name: remote.name,
    ...(replaced.arn ? { arn: replaced.arn } : {}),
    versionId: replaced.versionId,
  }, entry);
}

export async function pullSecret(
  key: string,
  options: AwsCommandOptions = {}
): Promise<AwsPlanResult | undefined> {
  const config = resolveAwsConfig(options);
  const name = awsName(key, config.prefix);

  // Offline by the same contract as pushSecret: no AWS command during planning.
  if (options.dryRun) {
    return planResult("pull", config, [
      {
        action: "pull",
        key,
        awsName: name,
        localState: (await getLocalMetadata(key)) ? "exists" : "missing",
        remoteState: "not-checked",
        mutation: "none",
        ...(options.expectedVersionId ? { remoteVersionId: options.expectedVersionId } : {}),
        note: options.expectedVersionId
          ? "Would read this exact AWSCURRENT version into the local vault, and refuse if it is no longer current at execution time."
          : "Would read the current AWS secret value and store it in the local vault.",
      },
    ]);
  }

  const client = clientFactory(config);
  const res = await client.send(new GetSecretValueCommand({
    SecretId: name,
    VersionStage: "AWSCURRENT",
    ...(options.expectedVersionId ? { VersionId: options.expectedVersionId } : {}),
  }));
  if (!res.SecretString) throw new Error(`No string value for secret: ${name}`);
  if (!res.VersionId) throw new Error(`AWS did not return a version for secret: ${name}`);
  if (options.expectedVersionId && res.VersionId !== options.expectedVersionId) {
    throw new Error(
      `AWS secret ${name} changed: expected ${options.expectedVersionId}, current ${res.VersionId}; refusing to pull it`
    );
  }

  await getStore().setSecret(key, res.SecretString);
  const metadata = await getLocalMetadata(key);
  if (!metadata) throw new Error(`Local secret disappeared after pull: ${key}`);
  recordCheckpoint(config, {
    name: res.Name ?? name,
    ...(res.ARN ? { arn: res.ARN } : {}),
    versionId: res.VersionId,
  }, metadata);
}

export async function syncAll(options: AwsCommandOptions = {}): Promise<AwsSyncResult> {
  const config = resolveAwsConfig(options);
  const pushed: string[] = [];
  const pulled: string[] = [];
  const plan = await planSync(config);
  const conflicts = plan.actions
    .filter((action): action is AwsPlanAction & { key: string; awsName: string } =>
      action.action === "conflict" && Boolean(action.key) && Boolean(action.awsName))
    .map((action) => ({
      key: action.key,
      awsName: action.awsName,
      ...(action.localUpdatedAt ? { localUpdatedAt: action.localUpdatedAt } : {}),
      ...(action.remoteVersionId ? { remoteVersionId: action.remoteVersionId } : {}),
      ...(action.baselineLocalUpdatedAt ? { baselineLocalUpdatedAt: action.baselineLocalUpdatedAt } : {}),
      ...(action.baselineRemoteVersionId ? { baselineRemoteVersionId: action.baselineRemoteVersionId } : {}),
      note: action.note,
    }));
  const errors = [...plan.errors];

  if (options.dryRun) {
    return { pushed, pulled, conflicts, errors, plan };
  }

  for (const action of plan.actions) {
    if (!action.key) continue;
    try {
      if (action.action === "push") {
        await pushSecret(action.key, options);
        pushed.push(action.key);
      } else if (action.action === "pull") {
        await pullSecret(action.key, { ...options, expectedVersionId: action.remoteVersionId });
        pulled.push(action.key);
      }
    } catch (e: any) {
      errors.push(`${action.action} ${action.key}: ${e.message}`);
    }
  }

  return { pushed, pulled, conflicts, errors };
}

function makeDefaultClient(config: ResolvedAwsConfig): SecretsManagerClient {
  const clientConfig: Record<string, unknown> = { region: config.region };
  if (config.credentialMode === "static") {
    clientConfig.credentials = config.staticCredentials;
  } else if (config.credentialMode === "profile") {
    clientConfig.credentials = fromIni({ profile: config.profile });
  } else if (config.credentialMode === "role") {
    clientConfig.credentials = fromTemporaryCredentials({
      ...(config.sourceProfile
        ? { masterCredentials: fromIni({ profile: config.sourceProfile }) }
        : {}),
      params: {
        RoleArn: config.roleArn!,
        RoleSessionName: config.sessionName ?? "open-secrets-sync",
        ...(config.externalId ? { ExternalId: config.externalId } : {}),
      },
    });
  }
  return new SecretsManagerClient(clientConfig as any);
}

async function planSync(config: ResolvedAwsConfig): Promise<AwsPlanResult> {
  const actions: AwsPlanAction[] = [{
    action: "list-remote",
    awsName: config.prefix ? `${config.prefix}/*` : "*",
    localState: "not-checked",
    remoteState: "unknown",
    mutation: "none",
    note: "ListSecrets and DescribeSecret read metadata and current version IDs only.",
  }];
  const errors: string[] = [];
  const local = await getStore().listSecretMetadata();
  const localByKey = new Map(local.map((entry) => [entry.key, entry]));
  const remoteByKey = new Map<string, RemoteSecretMetadata>();
  const state = loadAwsSyncState();

  try {
    const client = clientFactory(config);
    let nextToken: string | undefined;
    do {
      const res = await client.send(new ListSecretsCommand({ NextToken: nextToken, MaxResults: 100 }));
      for (const secret of res.SecretList ?? []) {
        if (!secret.Name) continue;
        if (config.prefix && !secret.Name.startsWith(`${config.prefix}/`)) continue;
        const key = localKey(secret.Name, config.prefix);
        // ListSecrets already returns SecretVersionsToStages, the same shape
        // DescribeSecret reports as VersionIdsToStages, so the AWSCURRENT version
        // is read straight off the page. A DescribeSecret per listed secret would
        // turn one API call into 1+N and make planning O(vault size) in requests.
        // A secret whose AWSCURRENT cannot be determined is left without a
        // versionId, and the reconciliation below turns that into a conflict.
        const versionId = currentVersionId(secret.SecretVersionsToStages);
        remoteByKey.set(key, {
          name: secret.Name,
          ...(secret.ARN ? { arn: secret.ARN } : {}),
          ...(versionId ? { versionId } : {}),
        });
      }
      nextToken = res.NextToken;
    } while (nextToken);
  } catch (e: any) {
    errors.push(`list: ${e.message}`);
    return planResult("sync", config, actions, errors);
  }

  for (const entry of local) {
    const name = awsName(entry.key, config.prefix);
    const remote = remoteByKey.get(entry.key);
    if (!remote) {
      actions.push({
        action: "push",
        key: entry.key,
        awsName: name,
        localState: "exists",
        remoteState: "missing",
        mutation: "none",
        localUpdatedAt: entry.updated_at,
        note: "Would create this missing AWS secret; sync never updates an existing remote value.",
      });
      continue;
    }

    if (!remote.versionId) {
      actions.push({
        action: "conflict",
        key: entry.key,
        awsName: remote.name,
        localState: "exists",
        remoteState: "unknown",
        mutation: "none",
        localUpdatedAt: entry.updated_at,
        note: "AWS AWSCURRENT version could not be verified; no value will be changed.",
      });
      continue;
    }

    const checkpoint = state.entries[remoteIdentity(config, remote.name, remote.arn)];
    if (!checkpoint || checkpoint.key !== entry.key || checkpoint.awsName !== remote.name) {
      actions.push({
        action: "conflict",
        key: entry.key,
        awsName: remote.name,
        localState: "exists",
        remoteState: "exists",
        mutation: "none",
        localUpdatedAt: entry.updated_at,
        remoteVersionId: remote.versionId,
        note: "Both sides exist without a shared version checkpoint; review and resolve with an explicit version-pinned push or pull.",
      });
      continue;
    }

    const localChanged = checkpoint.localUpdatedAt !== entry.updated_at;
    const remoteChanged = checkpoint.remoteVersionId !== remote.versionId;
    if (!localChanged && !remoteChanged) {
      actions.push({
        action: "noop",
        key: entry.key,
        awsName: remote.name,
        localState: "exists",
        remoteState: "exists",
        mutation: "none",
        localUpdatedAt: entry.updated_at,
        remoteVersionId: remote.versionId,
        baselineLocalUpdatedAt: checkpoint.localUpdatedAt,
        baselineRemoteVersionId: checkpoint.remoteVersionId,
        note: "Local and AWS versions still match the last reconciled checkpoint.",
      });
      continue;
    }

    const changedSide = localChanged && remoteChanged
      ? "Both local and AWS versions changed"
      : localChanged
        ? "The local version changed"
        : "The AWS version changed";
    actions.push({
      action: "conflict",
      key: entry.key,
      awsName: remote.name,
      localState: "exists",
      remoteState: "exists",
      mutation: "none",
      localUpdatedAt: entry.updated_at,
      remoteVersionId: remote.versionId,
      baselineLocalUpdatedAt: checkpoint.localUpdatedAt,
      baselineRemoteVersionId: checkpoint.remoteVersionId,
      note: `${changedSide} since the last reconciliation; review before an explicit version-pinned push or pull.`,
    });
  }

  for (const [key, remote] of remoteByKey) {
    if (localByKey.has(key)) continue;
    if (!remote.versionId) {
      actions.push({
        action: "conflict",
        key,
        awsName: remote.name,
        localState: "missing",
        remoteState: "unknown",
        mutation: "none",
        note: "AWS AWSCURRENT version could not be verified; no local value will be changed.",
      });
      continue;
    }
    actions.push({
      action: "pull",
      key,
      awsName: remote.name,
      localState: "missing",
      remoteState: "exists",
      mutation: "none",
      remoteVersionId: remote.versionId,
      note: "Would pull this exact AWSCURRENT version into the missing local key.",
    });
  }

  return planResult("sync", config, actions, errors);
}

function planResult(
  operation: AwsPlanResult["operation"],
  config: ResolvedAwsConfig,
  actions: AwsPlanAction[],
  errors: string[] = []
): AwsPlanResult {
  return {
    dryRun: true,
    operation,
    config: summarizeAwsConfig(config),
    actions,
    errors,
  };
}

async function getLocalMetadata(key: string): Promise<SecretMetadata | undefined> {
  return (await getStore().listSecretMetadata(key)).find((entry) => entry.key === key);
}

function awsName(key: string, prefix?: string): string {
  return prefix ? `${prefix}/${key}` : key;
}

function localKey(name: string, prefix?: string): string {
  if (prefix && name.startsWith(`${prefix}/`)) {
    return name.slice(prefix.length + 1);
  }
  return name;
}

function getStaticCredentials(config: AwsConfig): ResolvedAwsConfig["staticCredentials"] | undefined {
  if (!config.access_key_id || !config.secret_access_key) return undefined;
  return {
    accessKeyId: config.access_key_id,
    secretAccessKey: config.secret_access_key,
    ...(config.session_token ? { sessionToken: config.session_token } : {}),
  };
}

function inferCredentialMode(input: {
  roleArn?: string;
  explicitProfile?: string;
  storedProfile?: string;
  profile?: string;
  staticCredentials?: ResolvedAwsConfig["staticCredentials"];
}): AwsCredentialMode {
  if (input.roleArn) return "role";
  if (input.explicitProfile || input.storedProfile) return "profile";
  if (input.staticCredentials) return "static";
  if (input.profile) return "profile";
  return "default";
}

function normalizeCredentialMode(value?: string): AwsCredentialMode | undefined {
  if (!value) return undefined;
  if (value === "static" || value === "default" || value === "profile" || value === "role") {
    return value;
  }
  throw new Error(`Invalid AWS credential mode: ${value}`);
}

function first(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
