import { createHash } from "node:crypto";
import type { PoolQueryClient } from "../../generated/storage-kit/query.js";
import {
  loadTenantBackfillBundle,
  parseTenantBackfillBundle,
  type TenantBackfillBundle,
} from "./tenant-backfill.js";

const ECS_CREDENTIALS_ORIGIN = "http://169.254.170.2";
const ECS_CREDENTIALS_PATH = /^\/v2\/credentials\/[A-Za-z0-9_-]{1,128}$/;
const APPROVED_KEY = /^approved\/sha256-([0-9a-f]{64})\.json$/;
const AWS_REGION = /^[a-z0-9]+(?:-[a-z0-9]+)+-\d+$/;
const S3_BUCKET = /^(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export const TENANT_BACKFILL_MAX_BYTES = 10 * 1024 * 1024;

export interface TenantBackfillS3Client {
  list(input: { prefix: string; maxKeys: number }): Promise<{
    contents?: Array<{ key: string; size?: number }>;
    isTruncated?: boolean;
  }>;
  file(key: string): { bytes(): Promise<Uint8Array> };
  delete(key: string): Promise<void>;
}

interface TaskRoleCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

export type TenantBackfillFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface TenantBackfillS3Options {
  bucket: string;
  region: string;
  credentialsRelativeUri: string;
}

interface TenantBackfillS3Dependencies {
  fetch?: TenantBackfillFetch;
  createS3Client?: (options: TaskRoleCredentials & { bucket: string; region: string; endpoint: string }) => TenantBackfillS3Client;
  loadBundle?: typeof loadTenantBackfillBundle;
}

export interface TenantBackfillS3Result {
  digest: string;
  counts: {
    tenants: number;
    principals: number;
    memberships: number;
    keyBindings: number;
    rowAssignments: number;
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export async function fetchEcsTaskRoleCredentials(
  relativeUri: string,
  fetchImpl: TenantBackfillFetch = fetch,
): Promise<TaskRoleCredentials> {
  if (!ECS_CREDENTIALS_PATH.test(relativeUri)) {
    throw new Error("tenant backfill credential configuration is invalid");
  }

  try {
    const response = await fetchImpl(`${ECS_CREDENTIALS_ORIGIN}${relativeUri}`, {
      method: "GET",
      redirect: "error",
    });
    if (!response.ok) throw new Error("credential response rejected");
    const value = await response.json() as Record<string, unknown>;
    if (
      !nonEmptyString(value.AccessKeyId) ||
      !nonEmptyString(value.SecretAccessKey) ||
      !nonEmptyString(value.Token) ||
      !nonEmptyString(value.Expiration)
    ) {
      throw new Error("credential response malformed");
    }
    const expiration = Date.parse(value.Expiration);
    if (!Number.isFinite(expiration) || expiration <= Date.now()) {
      throw new Error("credential response expired");
    }
    return {
      accessKeyId: value.AccessKeyId,
      secretAccessKey: value.SecretAccessKey,
      sessionToken: value.Token,
    };
  } catch {
    throw new Error("tenant backfill credential retrieval failed");
  }
}

function validateDeliveryOptions(options: TenantBackfillS3Options): void {
  if (
    !S3_BUCKET.test(options.bucket) ||
    options.bucket.includes("..") ||
    options.bucket.includes(".-") ||
    options.bucket.includes("-.") ||
    !AWS_REGION.test(options.region)
  ) {
    throw new Error("tenant backfill S3 configuration is invalid");
  }
}

function countsFor(bundle: TenantBackfillBundle): TenantBackfillS3Result["counts"] {
  return {
    tenants: bundle.tenants.length,
    principals: bundle.principals.length,
    memberships: bundle.memberships.length,
    keyBindings: bundle.keyBindings.length,
    rowAssignments: bundle.rowAssignments.length,
  };
}

function nativeS3Client(options: TaskRoleCredentials & { bucket: string; region: string; endpoint: string }): TenantBackfillS3Client {
  return new Bun.S3Client(options);
}

function awsS3Endpoint(region: string): string {
  const suffix = region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
  return `https://s3.${region}.${suffix}`;
}

export async function loadApprovedTenantBackfillBundle(
  queryClient: PoolQueryClient,
  options: TenantBackfillS3Options,
  dependencies: TenantBackfillS3Dependencies = {},
): Promise<TenantBackfillS3Result> {
  validateDeliveryOptions(options);
  const credentials = await fetchEcsTaskRoleCredentials(
    options.credentialsRelativeUri,
    dependencies.fetch ?? fetch,
  );

  let s3: TenantBackfillS3Client;
  try {
    s3 = (dependencies.createS3Client ?? nativeS3Client)({
      ...credentials,
      bucket: options.bucket,
      region: options.region,
      endpoint: awsS3Endpoint(options.region),
    });
  } catch {
    throw new Error("tenant backfill S3 client initialization failed");
  }

  let selectedKey: string | undefined;
  try {
    let listing: Awaited<ReturnType<TenantBackfillS3Client["list"]>>;
    try {
      listing = await s3.list({ prefix: "approved/", maxKeys: 2 });
    } catch {
      throw new Error("tenant backfill approved object listing failed");
    }

    const objects = listing.contents ?? [];
    if (objects.length === 1) selectedKey = objects[0]!.key;
    if (listing.isTruncated || objects.length !== 1) {
      throw new Error("tenant backfill delivery requires exactly one approved object");
    }

    const object = objects[0]!;
    const keyMatch = APPROVED_KEY.exec(object.key);
    if (!keyMatch) throw new Error("tenant backfill approved object key is invalid");
    const expectedDigest = keyMatch[1]!;

    const listedSize = object.size;
    if (typeof listedSize !== "number" || !Number.isSafeInteger(listedSize) || listedSize < 0) {
      throw new Error("tenant backfill approved object metadata is invalid");
    }
    if (listedSize > TENANT_BACKFILL_MAX_BYTES) {
      throw new Error("tenant backfill approved object exceeds the size limit");
    }

    let bytes: Uint8Array;
    try {
      bytes = await s3.file(object.key).bytes();
    } catch {
      throw new Error("tenant backfill approved object read failed");
    }
    if (bytes.byteLength > TENANT_BACKFILL_MAX_BYTES) {
      throw new Error("tenant backfill approved object exceeds the size limit");
    }

    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    if (actualDigest !== expectedDigest) {
      throw new Error("tenant backfill approved object digest mismatch");
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new Error("tenant backfill approved object is not valid JSON");
    }

    let bundle: TenantBackfillBundle;
    try {
      bundle = parseTenantBackfillBundle(decoded);
    } catch {
      throw new Error("tenant backfill approved object schema is invalid");
    }

    const counts = countsFor(bundle);
    try {
      const loaded = await (dependencies.loadBundle ?? loadTenantBackfillBundle)(queryClient, bundle);
      if (loaded.assignments !== counts.rowAssignments) {
        throw new Error("assignment count mismatch");
      }
    } catch {
      throw new Error("tenant backfill transaction failed");
    }

    return { digest: `sha256:${expectedDigest}`, counts };
  } finally {
    if (selectedKey) {
      try {
        await s3.delete(selectedKey);
      } catch {
        throw new Error("tenant backfill approved object cleanup failed");
      }
    }
  }
}

export function logTenantBackfillS3Success(result: TenantBackfillS3Result): void {
  console.log(JSON.stringify({ evt: "tenant_backfill_s3_loaded", ...result }));
}
