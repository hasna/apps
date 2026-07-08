import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  UpdateSecretCommand,
  ListSecretsCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { fromIni, fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getStore } from "./store/index.js";
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
  action: "push" | "pull" | "list-remote";
  key?: string;
  awsName?: string;
  localState?: "exists" | "missing" | "not-checked";
  remoteState?: "exists" | "missing" | "not-checked" | "unknown";
  mutation: "none" | "aws-write" | "local-write";
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
  errors: string[];
  plan?: AwsPlanResult;
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

let clientFactory: AwsClientFactory = (config) => makeDefaultClient(config);

function getAwsConfigPath(): string {
  return join(homedir(), ".hasna", "secrets", "aws.json");
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

export function setAwsClientFactoryForTests(factory?: AwsClientFactory): void {
  clientFactory = factory ?? ((config) => makeDefaultClient(config));
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

export async function pushSecret(
  key: string,
  options: AwsCommandOptions = {}
): Promise<AwsPlanResult | undefined> {
  const config = resolveAwsConfig(options);
  const name = awsName(key, config.prefix);

  if (options.dryRun) {
    const metadata = getLocalMetadata(key);
    if (!metadata) throw new Error(`Secret not found: ${key}`);
    return planResult("push", config, [
      {
        action: "push",
        key,
        awsName: name,
        localState: "exists",
        remoteState: "not-checked",
        mutation: "none",
        note: "Would create or update the AWS Secrets Manager secret without printing the value.",
      },
    ]);
  }

  const entry = await getStore().getSecret(key);
  if (!entry) throw new Error(`Secret not found: ${key}`);

  const client = clientFactory(config);
  try {
    await client.send(new GetSecretValueCommand({ SecretId: name }));
    await client.send(new UpdateSecretCommand({ SecretId: name, SecretString: entry.value }));
  } catch (e: any) {
    if (e instanceof ResourceNotFoundException || e.name === "ResourceNotFoundException") {
      await client.send(
        new CreateSecretCommand({
          Name: name,
          SecretString: entry.value,
          Description: entry.label ?? `Managed by open-secrets (type: ${entry.type})`,
          Tags: [
            { Key: "open-secrets-key", Value: key },
            { Key: "open-secrets-type", Value: entry.type },
          ],
        })
      );
    } else {
      throw e;
    }
  }
}

export async function pullSecret(
  key: string,
  options: AwsCommandOptions = {}
): Promise<AwsPlanResult | undefined> {
  const config = resolveAwsConfig(options);
  const name = awsName(key, config.prefix);

  if (options.dryRun) {
    return planResult("pull", config, [
      {
        action: "pull",
        key,
        awsName: name,
        localState: (await getLocalMetadata(key)) ? "exists" : "missing",
        remoteState: "not-checked",
        mutation: "none",
        note: "Would read the AWS secret value and store it in the local vault.",
      },
    ]);
  }

  const client = clientFactory(config);
  const res = await client.send(new GetSecretValueCommand({ SecretId: name }));
  if (!res.SecretString) throw new Error(`No string value for secret: ${name}`);

  await getStore().setSecret(key, res.SecretString);
}

export async function syncAll(options: AwsCommandOptions = {}): Promise<AwsSyncResult> {
  const config = resolveAwsConfig(options);
  const pushed: string[] = [];
  const pulled: string[] = [];
  const errors: string[] = [];

  if (options.dryRun) {
    return {
      pushed,
      pulled,
      errors,
      plan: await planSync(config),
    };
  }

  const client = clientFactory(config);

  for (const entry of await getStore().listSecretMetadata()) {
    try {
      await pushSecret(entry.key, options);
      pushed.push(entry.key);
    } catch (e: any) {
      errors.push(`push ${entry.key}: ${e.message}`);
    }
  }

  try {
    let nextToken: string | undefined;
    do {
      const res = await client.send(
        new ListSecretsCommand({ NextToken: nextToken, MaxResults: 100 })
      );
      for (const s of res.SecretList ?? []) {
        if (!s.Name) continue;
        if (config.prefix && !s.Name.startsWith(`${config.prefix}/`)) continue;
        const key = localKey(s.Name, config.prefix);
        if (!getLocalMetadata(key)) {
          try {
            await pullSecret(key, options);
            pulled.push(key);
          } catch (e: any) {
            errors.push(`pull ${key}: ${e.message}`);
          }
        }
      }
      nextToken = res.NextToken;
    } while (nextToken);
  } catch (e: any) {
    errors.push(`list: ${e.message}`);
  }

  return { pushed, pulled, errors };
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
  const actions: AwsPlanAction[] = [];
  const errors: string[] = [];
  const local = await getStore().listSecretMetadata();
  const localKeys = new Set(local.map((entry) => entry.key));

  for (const entry of local) {
    actions.push({
      action: "push",
      key: entry.key,
      awsName: awsName(entry.key, config.prefix),
      localState: "exists",
      remoteState: "not-checked",
      mutation: "none",
      note: "Would create or update the AWS Secrets Manager secret without printing the value.",
    });
  }

  actions.push({
    action: "list-remote",
    awsName: config.prefix ? `${config.prefix}/*` : "*",
    localState: "not-checked",
    remoteState: "unknown",
    mutation: "none",
    note: "ListSecrets is metadata-only and is used to identify remote names missing locally.",
  });

  try {
    const client = clientFactory(config);
    let nextToken: string | undefined;
    do {
      const res = await client.send(new ListSecretsCommand({ NextToken: nextToken, MaxResults: 100 }));
      for (const secret of res.SecretList ?? []) {
        if (!secret.Name) continue;
        if (config.prefix && !secret.Name.startsWith(`${config.prefix}/`)) continue;
        const key = localKey(secret.Name, config.prefix);
        if (!localKeys.has(key)) {
          actions.push({
            action: "pull",
            key,
            awsName: secret.Name,
            localState: "missing",
            remoteState: "exists",
            mutation: "none",
            note: "Would pull the AWS secret value into the local vault.",
          });
        }
      }
      nextToken = res.NextToken;
    } while (nextToken);
  } catch (e: any) {
    errors.push(`list: ${e.message}`);
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
