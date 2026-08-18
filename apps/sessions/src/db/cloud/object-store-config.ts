import type { S3Config } from "./s3-client.js";

export const SESSION_OBJECT_STORE_ENV = {
  bucket: "HASNA_SESSIONS_S3_BUCKET",
  region: "HASNA_SESSIONS_S3_REGION",
  endpoint: "HASNA_SESSIONS_S3_ENDPOINT",
  prefix: "HASNA_SESSIONS_S3_PREFIX",
  accessKeyId: "HASNA_SESSIONS_S3_ACCESS_KEY_ID",
  secretAccessKey: "HASNA_SESSIONS_S3_SECRET_ACCESS_KEY",
} as const;

export interface SessionObjectStoreConfig extends S3Config {
  prefix: string;
}

function optionalValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function normalizeSessionObjectPrefix(prefix: string | undefined): string {
  return prefix?.trim().replace(/^\/+|\/+$/g, "") ?? "";
}

export function prefixSessionObjectKey(prefix: string, objectKey: string): string {
  return prefix ? `${prefix}/${objectKey}` : objectKey;
}

/**
 * Resolve optional session object storage without rendering any credential values.
 * A missing bucket means the legacy local-only path remains active.
 */
export function resolveSessionObjectStoreConfig(
  env: NodeJS.ProcessEnv = process.env,
): SessionObjectStoreConfig | null {
  const bucket = optionalValue(env, SESSION_OBJECT_STORE_ENV.bucket);
  if (!bucket) return null;

  const accessKeyId = optionalValue(env, SESSION_OBJECT_STORE_ENV.accessKeyId);
  const secretAccessKey = optionalValue(env, SESSION_OBJECT_STORE_ENV.secretAccessKey);
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error(
      `Incomplete sessions object-store credentials: ${SESSION_OBJECT_STORE_ENV.accessKeyId} and ${SESSION_OBJECT_STORE_ENV.secretAccessKey} must be configured together`,
    );
  }

  const endpoint = optionalValue(env, SESSION_OBJECT_STORE_ENV.endpoint);

  return {
    bucket,
    region:
      optionalValue(env, SESSION_OBJECT_STORE_ENV.region) ??
      optionalValue(env, "AWS_REGION") ??
      "us-east-1",
    ...(endpoint ? { endpoint } : {}),
    ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
    prefix: normalizeSessionObjectPrefix(
      optionalValue(env, SESSION_OBJECT_STORE_ENV.prefix),
    ),
  };
}
