/**
 * Optional S3 configuration for Instructions backups and immutable objects.
 *
 * This configuration never selects a database or client transport. SQLite and
 * PostgreSQL remain the only record authorities; a bucket merely enables an
 * adjunct backup/object plane for explicit callers.
 */
export type InstructionsS3Env = Record<string, string | undefined>;

export interface InstructionsS3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface InstructionsS3Config {
  provider: "s3";
  bucket: string;
  prefix: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  credentials?: InstructionsS3Credentials;
}

export const INSTRUCTIONS_S3_ENV = {
  bucket: "HASNA_INSTRUCTIONS_S3_BUCKET",
  prefix: "HASNA_INSTRUCTIONS_S3_PREFIX",
  region: "HASNA_INSTRUCTIONS_AWS_REGION",
  endpoint: "HASNA_INSTRUCTIONS_S3_ENDPOINT",
  forcePathStyle: "HASNA_INSTRUCTIONS_S3_FORCE_PATH_STYLE",
  accessKeyId: "HASNA_INSTRUCTIONS_S3_ACCESS_KEY_ID",
  secretAccessKey: "HASNA_INSTRUCTIONS_S3_SECRET_ACCESS_KEY",
  sessionToken: "HASNA_INSTRUCTIONS_S3_SESSION_TOKEN",
} as const;

export const INSTRUCTIONS_S3_ALIAS_ENV = {
  bucket: "INSTRUCTIONS_S3_BUCKET",
  prefix: "INSTRUCTIONS_S3_PREFIX",
  region: "INSTRUCTIONS_AWS_REGION",
  endpoint: "INSTRUCTIONS_S3_ENDPOINT",
  forcePathStyle: "INSTRUCTIONS_S3_FORCE_PATH_STYLE",
  accessKeyId: "INSTRUCTIONS_S3_ACCESS_KEY_ID",
  secretAccessKey: "INSTRUCTIONS_S3_SECRET_ACCESS_KEY",
  sessionToken: "INSTRUCTIONS_S3_SESSION_TOKEN",
} as const;

const BUCKET_PATTERN = /^(?!xn--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function loadInstructionsS3Config(
  env: InstructionsS3Env = process.env,
): InstructionsS3Config | undefined {
  const bucket = readEnv(env, "bucket");
  const configuredWithoutBucket = (Object.keys(INSTRUCTIONS_S3_ENV) as Array<keyof typeof INSTRUCTIONS_S3_ENV>)
    .filter((key) => key !== "bucket")
    .some((key) => readEnv(env, key) !== undefined);

  if (!bucket) {
    if (configuredWithoutBucket) {
      throw new Error(`${INSTRUCTIONS_S3_ENV.bucket} is required when any Instructions S3 setting is configured`);
    }
    return undefined;
  }

  validateBucket(bucket);
  const prefix = normalizeInstructionsS3Prefix(readEnv(env, "prefix") ?? "instructions/");
  const region = readEnv(env, "region") ?? "us-east-1";
  validateRegion(region);
  const endpoint = normalizeEndpoint(readEnv(env, "endpoint"));
  const forcePathStyle = parseBoolean(readEnv(env, "forcePathStyle"), false);

  const accessKeyId = readEnv(env, "accessKeyId");
  const secretAccessKey = readEnv(env, "secretAccessKey");
  const sessionToken = readEnv(env, "sessionToken");
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error(
      `${INSTRUCTIONS_S3_ENV.accessKeyId} and ${INSTRUCTIONS_S3_ENV.secretAccessKey} must be configured together`,
    );
  }
  if (sessionToken && (!accessKeyId || !secretAccessKey)) {
    throw new Error(`${INSTRUCTIONS_S3_ENV.sessionToken} requires a complete static credential pair`);
  }

  return {
    provider: "s3",
    bucket,
    prefix,
    region,
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle,
    ...(accessKeyId && secretAccessKey
      ? {
          credentials: {
            accessKeyId,
            secretAccessKey,
            ...(sessionToken ? { sessionToken } : {}),
          },
        }
      : {}),
  };
}

/** Normalize a bucket-relative prefix while rejecting traversal and ambiguity. */
export function normalizeInstructionsS3Prefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || CONTROL_CHARACTERS.test(trimmed) || trimmed.includes("\\")) {
    throw new Error("Instructions S3 prefix is invalid");
  }
  const withoutEdges = trimmed.replace(/^\/+|\/+$/g, "");
  if (!withoutEdges || withoutEdges.includes("//")) {
    throw new Error("Instructions S3 prefix is invalid");
  }
  const segments = withoutEdges.split("/");
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error("Instructions S3 prefix contains invalid percent encoding");
    }
    if (!decoded || decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\") || CONTROL_CHARACTERS.test(decoded)) {
      throw new Error("Instructions S3 prefix contains an unsafe path segment");
    }
  }
  return `${segments.join("/")}/`;
}

function readEnv(
  env: InstructionsS3Env,
  key: keyof typeof INSTRUCTIONS_S3_ENV,
): string | undefined {
  const canonical = INSTRUCTIONS_S3_ENV[key];
  if (Object.prototype.hasOwnProperty.call(env, canonical)) return clean(env[canonical]);
  return clean(env[INSTRUCTIONS_S3_ALIAS_ENV[key]]);
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  switch (value.toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error("Instructions S3 boolean setting is invalid");
  }
}

function validateBucket(bucket: string): void {
  if (
    bucket.length < 3 ||
    bucket.length > 63 ||
    !BUCKET_PATTERN.test(bucket) ||
    bucket.includes("..") ||
    bucket.includes(".-") ||
    bucket.includes("-.") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucket)
  ) {
    throw new Error("Instructions S3 bucket is invalid");
  }
}

function validateRegion(region: string): void {
  if (!REGION_PATTERN.test(region)) throw new Error("Instructions AWS region is invalid");
}

function normalizeEndpoint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("Instructions S3 endpoint is invalid");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Instructions S3 endpoint must not contain credentials, query parameters, or fragments");
  }
  if (endpoint.pathname !== "/") {
    throw new Error("Instructions S3 endpoint must be an origin without a path");
  }
  const localHttp = endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !localHttp) {
    throw new Error("Instructions S3 endpoint must use HTTPS (HTTP is allowed only for loopback development)");
  }
  return endpoint.origin;
}
