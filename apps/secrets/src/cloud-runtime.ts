import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  CANONICAL_SECRETS_RDS_SECRET_PATH,
  SECRETS_STORAGE_ENV,
  getStorageStatus,
  type NativeStorageStatus,
} from "./storage-sync.js";

export const CLOUD_SECRET_REFERENCE_SCHEMA_VERSION = "1.0";
export const CANONICAL_SECRETS_S3_SECRET_PATH = "hasna/xyz/opensource/secrets/prod/s3";
export const CANONICAL_SECRETS_AWS_SECRET_PATH = "hasna/xyz/opensource/secrets/prod/aws";

export type CloudSecretReferenceProvider = "aws-secrets-manager";
export type CloudRuntimeStorageProvider =
  | "local-sqlite"
  | "local-files"
  | "remote-postgres"
  | "remote-s3"
  | "aws-secrets-manager";

export interface AwsSecretsManagerReferenceInput extends Record<string, unknown> {
  provider?: CloudSecretReferenceProvider;
  secretId?: string;
  region?: string;
  field?: string;
  versionStage?: string;
  purpose?: string;
}

export interface AwsSecretsManagerSecretReference {
  service: "secrets";
  schemaVersion: typeof CLOUD_SECRET_REFERENCE_SCHEMA_VERSION;
  provider: "aws-secrets-manager";
  secretId: string;
  region?: string;
  field?: string;
  versionStage?: string;
  purpose?: string;
  resolution: "runtime-consumer";
  valueIncluded: false;
  diagnosticsOnly: true;
}

export type CloudSecretReference = AwsSecretsManagerSecretReference;

export interface CloudRuntimeReferenceStatus {
  service: "secrets";
  schemaVersion: typeof CLOUD_SECRET_REFERENCE_SCHEMA_VERSION;
  local: {
    sqlite: {
      provider: "local-sqlite";
      defaultPath: "~/.hasna/secrets/vault.db";
      activePath: string;
      env: {
        primary: "HASNA_SECRETS_DB_PATH";
        fallback: "OPEN_SECRETS_DB";
        active: "HASNA_SECRETS_DB_PATH" | "OPEN_SECRETS_DB" | null;
        configured: boolean;
        includesRawValue: false;
      };
      network: "none";
      includesRows: false;
      includesValues: false;
    };
    files: {
      provider: "local-files";
      bridgeRoot: "~/.secrets";
      purpose: "machine-local env-file import/export bridge";
      cloudRuntimeBackingStore: false;
      includesFileContents: false;
      includesValues: false;
    };
  };
  remote: {
    postgres: {
      provider: "remote-postgres";
      enabled: boolean;
      mode: NativeStorageStatus["mode"];
      database: NativeStorageStatus["database"];
      canonical: NativeStorageStatus["canonical"];
      env: NativeStorageStatus["env"]["databaseUrl"];
      includesRows: false;
      includesValues: false;
      noNetwork: true;
    };
    s3: {
      provider: "remote-s3";
      runtimeObjectStore: false;
      canonicalSecretPath: typeof CANONICAL_SECRETS_S3_SECRET_PATH;
      note: "S3 is not a value backing store for @hasna/secrets; app S3 config is represented as an AWS Secrets Manager reference.";
      includesObjects: false;
      includesValues: false;
      noNetwork: true;
    };
  };
  aws: {
    secretsManager: {
      provider: "aws-secrets-manager";
      supportedReferenceProvider: true;
      canonicalRuntimeSecretPaths: {
        rds: typeof CANONICAL_SECRETS_RDS_SECRET_PATH;
        s3: typeof CANONICAL_SECRETS_S3_SECRET_PATH;
        aws: typeof CANONICAL_SECRETS_AWS_SECRET_PATH;
      };
      valueResolutionOwner: "runtime-consumer";
      diagnosticsReadSecretValues: false;
      diagnosticsMutateCloudResources: false;
      dryRunMutatesCloudResources: false;
      allowedReferenceFields: readonly ["secretId", "region", "field", "versionStage", "purpose"];
    };
  };
  audit: {
    diagnosticsCreateAuditEntries: false;
    referenceIdentifiersMayBeAudited: true;
    secretValuesMayBeAudited: false;
  };
  safety: {
    includesSecretValues: false;
    includesRawEnvValues: false;
    includesAwsSecretString: false;
    includesRemoteRows: false;
    includesLocalFileContents: false;
    metadataOnlyDiagnostics: true;
    failsClosedForUnsupportedProviders: true;
  };
}

const FORBIDDEN_VALUE_FIELDS = new Set([
  "value",
  "secretvalue",
  "secretstring",
  "secretbinary",
  "password",
  "token",
  "apikey",
  "authorization",
  "clientsecret",
  "credential",
  "credentials",
  "accesskeyid",
  "secretaccesskey",
  "sessiontoken",
  "privatekey",
  "databaseurl",
]);

const ALLOWED_REFERENCE_FIELDS = new Set(["provider", "secretId", "region", "field", "versionStage", "purpose"]);
const AWS_SECRET_NAME_PATTERN = /^[A-Za-z0-9/_+=.@-]{1,512}$/;
const AWS_SECRET_ARN_PATTERN =
  /^arn:(aws|aws-us-gov|aws-cn):secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$/;

export function createCloudSecretReference(input: AwsSecretsManagerReferenceInput): CloudSecretReference {
  assertNoValueFields(input);
  assertAllowedReferenceFields(input);
  const provider = normalizeProvider(input.provider);
  if (!provider) {
    throw new Error("Cloud secret reference requires provider");
  }
  if (provider !== "aws-secrets-manager") {
    throw new Error("Unsupported cloud secret reference provider");
  }
  return createAwsSecretsManagerReference(input);
}

export function createAwsSecretsManagerReference(
  input: AwsSecretsManagerReferenceInput
): AwsSecretsManagerSecretReference {
  assertNoValueFields(input);
  assertAllowedReferenceFields(input);
  const secretId = normalizeRequiredIdentifier(input.secretId, "secretId");
  const region = normalizeOptionalIdentifier(input.region, "region");
  const field = normalizeOptionalIdentifier(input.field, "field");
  const versionStage = normalizeOptionalIdentifier(input.versionStage, "versionStage");
  const purpose = normalizeOptionalIdentifier(input.purpose, "purpose");

  return {
    service: "secrets",
    schemaVersion: CLOUD_SECRET_REFERENCE_SCHEMA_VERSION,
    provider: "aws-secrets-manager",
    secretId,
    ...(region ? { region } : {}),
    ...(field ? { field } : {}),
    ...(versionStage ? { versionStage } : {}),
    ...(purpose ? { purpose } : {}),
    resolution: "runtime-consumer",
    valueIncluded: false,
    diagnosticsOnly: true,
  };
}

export function getCloudRuntimeReferenceStatus(): CloudRuntimeReferenceStatus {
  const storage = getStorageStatus();
  return {
    service: "secrets",
    schemaVersion: CLOUD_SECRET_REFERENCE_SCHEMA_VERSION,
    local: {
      sqlite: {
        provider: "local-sqlite",
        defaultPath: "~/.hasna/secrets/vault.db",
        activePath: redactedLocalDatabasePath(),
        env: {
          primary: "HASNA_SECRETS_DB_PATH",
          fallback: "OPEN_SECRETS_DB",
          active: activeDatabasePathEnv(),
          configured: Boolean(activeDatabasePathEnv()),
          includesRawValue: false,
        },
        network: "none",
        includesRows: false,
        includesValues: false,
      },
      files: {
        provider: "local-files",
        bridgeRoot: "~/.secrets",
        purpose: "machine-local env-file import/export bridge",
        cloudRuntimeBackingStore: false,
        includesFileContents: false,
        includesValues: false,
      },
    },
    remote: {
      postgres: {
        provider: "remote-postgres",
        enabled: storage.remote_enabled,
        mode: storage.mode,
        database: storage.database,
        canonical: storage.canonical,
        env: storage.env.databaseUrl,
        includesRows: false,
        includesValues: false,
        noNetwork: true,
      },
      s3: {
        provider: "remote-s3",
        runtimeObjectStore: false,
        canonicalSecretPath: CANONICAL_SECRETS_S3_SECRET_PATH,
        note: "S3 is not a value backing store for @hasna/secrets; app S3 config is represented as an AWS Secrets Manager reference.",
        includesObjects: false,
        includesValues: false,
        noNetwork: true,
      },
    },
    aws: {
      secretsManager: {
        provider: "aws-secrets-manager",
        supportedReferenceProvider: true,
        canonicalRuntimeSecretPaths: {
          rds: CANONICAL_SECRETS_RDS_SECRET_PATH,
          s3: CANONICAL_SECRETS_S3_SECRET_PATH,
          aws: CANONICAL_SECRETS_AWS_SECRET_PATH,
        },
        valueResolutionOwner: "runtime-consumer",
        diagnosticsReadSecretValues: false,
        diagnosticsMutateCloudResources: false,
        dryRunMutatesCloudResources: false,
        allowedReferenceFields: ["secretId", "region", "field", "versionStage", "purpose"],
      },
    },
    audit: {
      diagnosticsCreateAuditEntries: false,
      referenceIdentifiersMayBeAudited: true,
      secretValuesMayBeAudited: false,
    },
    safety: {
      includesSecretValues: false,
      includesRawEnvValues: false,
      includesAwsSecretString: false,
      includesRemoteRows: false,
      includesLocalFileContents: false,
      metadataOnlyDiagnostics: true,
      failsClosedForUnsupportedProviders: true,
    },
  };
}

function normalizeProvider(value: unknown): CloudSecretReferenceProvider | string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function assertAllowedReferenceFields(input: Record<string, unknown>): void {
  for (const key of Object.keys(input)) {
    if (!ALLOWED_REFERENCE_FIELDS.has(key)) {
      throw new Error("Unsupported cloud secret reference field");
    }
  }
}

function assertNoValueFields(input: Record<string, unknown>): void {
  for (const key of Object.keys(input)) {
    const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (FORBIDDEN_VALUE_FIELDS.has(normalized) && input[key] !== undefined && input[key] !== null && input[key] !== "") {
      throw new Error("Cloud secret references must not include secret values; pass an AWS Secrets Manager secretId and optional metadata only.");
    }
  }
}

function normalizeRequiredIdentifier(value: unknown, fieldName: string): string {
  const normalized = normalizeOptionalIdentifier(value, fieldName);
  if (!normalized) throw new Error(`Cloud secret reference requires ${fieldName}`);
  return normalized;
}

function normalizeOptionalIdentifier(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Cloud secret reference ${fieldName} must be a string`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (/[\r\n\u0000-\u001f]/.test(normalized)) {
    throw new Error(`Cloud secret reference ${fieldName} must be a single-line identifier`);
  }
  if (fieldName === "secretId" && !isAwsSecretIdentifier(normalized)) {
    throw new Error("Cloud secret reference secretId must be an AWS Secrets Manager name or ARN");
  }
  return normalized;
}

function isAwsSecretIdentifier(value: string): boolean {
  return AWS_SECRET_NAME_PATTERN.test(value) || AWS_SECRET_ARN_PATTERN.test(value);
}

function activeDatabasePathEnv(): "HASNA_SECRETS_DB_PATH" | "OPEN_SECRETS_DB" | null {
  if (process.env["HASNA_SECRETS_DB_PATH"]) return "HASNA_SECRETS_DB_PATH";
  if (process.env["OPEN_SECRETS_DB"]) return "OPEN_SECRETS_DB";
  return null;
}

function redactedLocalDatabasePath(): "~/.hasna/secrets/vault.db" | "<custom-database-path>" {
  const active = activeDatabasePathEnv();
  if (active) return "<custom-database-path>";
  const defaultPath = join(homedir(), ".hasna", "secrets", "vault.db");
  const configured = process.env["HASNA_SECRETS_DB_PATH"] ?? process.env["OPEN_SECRETS_DB"] ?? defaultPath;
  return dirname(configured) === dirname(defaultPath) ? "~/.hasna/secrets/vault.db" : "<custom-database-path>";
}
