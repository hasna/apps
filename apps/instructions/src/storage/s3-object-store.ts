import { createHash, createHmac } from "node:crypto";
import type { InstructionsS3Config, InstructionsS3Credentials } from "./s3-config.js";

export interface InstructionsObjectMetadata {
  size: number;
  etag?: string;
  contentType?: string;
  lastModified?: Date;
  versionId?: string;
}

export interface InstructionsObjectReadOptions {
  /** Read exactly this immutable S3 object version instead of the current key. */
  versionId?: string;
}

export interface InstructionsObjectCreateResult {
  status: "created" | "existing";
  /** Present when S3 returned the immutable version created by this request. */
  versionId?: string;
}

/** Backup-only object plane: conditional creation plus read-only access. */
export interface InstructionsObjectStore {
  /** Atomically create only when the key is absent; never replace an existing object. */
  putIfAbsent?(
    key: string,
    bytes: Uint8Array,
    options: { contentType: string },
  ): Promise<InstructionsObjectCreateResult>;
  get(key: string, options?: InstructionsObjectReadOptions): Promise<Uint8Array | undefined>;
  head(key: string, options?: InstructionsObjectReadOptions): Promise<InstructionsObjectMetadata | undefined>;
}

export interface InstructionsAtomicObjectStore extends InstructionsObjectStore {
  putIfAbsent(
    key: string,
    bytes: Uint8Array,
    options: { contentType: string },
  ): Promise<InstructionsObjectCreateResult>;
}

export interface InstructionsNativeS3File {
  exists(): Promise<boolean>;
  bytes(): Promise<Uint8Array>;
  stat(): Promise<{ size: number; etag: string; type: string; lastModified: Date }>;
}

export interface InstructionsNativeS3Client {
  presign(key: string, options: { method: "PUT"; expiresIn: number }): string;
  file(key: string): InstructionsNativeS3File;
}

export type InstructionsNativeS3ClientFactory = (
  options: ConstructorParameters<typeof Bun.S3Client>[0],
) => InstructionsNativeS3Client;

export type InstructionsS3Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Backward-compatible name for the injectable S3 HTTP transport. */
export type InstructionsConditionalCreateFetch = InstructionsS3Fetch;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const VERSION_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,1024}$/;
const CONDITIONAL_CREATE_ATTEMPTS = 3;
const DEFAULT_EXISTS_DEADLINE_MS = 5_000;
const DEFAULT_BYTES_DEADLINE_MS = 15_000;
const DEFAULT_STAT_DEADLINE_MS = 5_000;
const DEFAULT_VERSIONED_READ_DEADLINE_MS = 15_000;
const DEFAULT_CONDITIONAL_CREATE_ATTEMPT_DEADLINE_MS = 15_000;
const DEFAULT_EXISTENCE_RECONCILIATION_DEADLINE_MS = 5_000;
const MAX_OPERATION_DEADLINE_MS = 60_000;
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

export interface InstructionsS3OperationDeadlines {
  existsDeadlineMs?: number;
  bytesDeadlineMs?: number;
  statDeadlineMs?: number;
  versionedReadDeadlineMs?: number;
  conditionalCreateAttemptDeadlineMs?: number;
  existenceReconciliationDeadlineMs?: number;
}

function resolveOperationDeadlineMs(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > MAX_OPERATION_DEADLINE_MS) {
    throw new Error(`${label} must be an integer between 1 and ${MAX_OPERATION_DEADLINE_MS} milliseconds`);
  }
  return resolved;
}

async function runWithDeadline<T>(
  operation: () => Promise<T>,
  deadlineMs: number,
  onDeadline?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        onDeadline?.();
      } finally {
        reject(new Error("Instructions S3 operation deadline exceeded"));
      }
    }, deadlineMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Validate a complete bucket-relative object key at every adapter boundary. */
export function assertSafeInstructionsObjectKey(key: string): void {
  if (
    !key ||
    key.length > 1024 ||
    key.startsWith("/") ||
    key.endsWith("/") ||
    key.includes("\\") ||
    CONTROL_CHARACTERS.test(key)
  ) {
    throw new Error("Instructions S3 object key is invalid");
  }
  for (const segment of key.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("Instructions S3 object key contains an unsafe path segment");
    }
  }
}

export function assertSafeInstructionsObjectVersionId(versionId: string): void {
  if (!VERSION_ID_PATTERN.test(versionId) || versionId.trim() !== versionId) {
    throw new Error("Instructions S3 object version id is invalid");
  }
}

/** Bun-native S3 adapter; public operations are immutable-create and read-only. */
export function createInstructionsS3ObjectStore(
  config: InstructionsS3Config,
  createClient: InstructionsNativeS3ClientFactory = (options) => new Bun.S3Client(options),
  requestFetch: InstructionsS3Fetch = fetch,
  deadlines: InstructionsS3OperationDeadlines = {},
): InstructionsAtomicObjectStore {
  const existsDeadlineMs = resolveOperationDeadlineMs(
    deadlines.existsDeadlineMs,
    DEFAULT_EXISTS_DEADLINE_MS,
    "Instructions S3 exists deadline",
  );
  const bytesDeadlineMs = resolveOperationDeadlineMs(
    deadlines.bytesDeadlineMs,
    DEFAULT_BYTES_DEADLINE_MS,
    "Instructions S3 bytes deadline",
  );
  const statDeadlineMs = resolveOperationDeadlineMs(
    deadlines.statDeadlineMs,
    DEFAULT_STAT_DEADLINE_MS,
    "Instructions S3 stat deadline",
  );
  const versionedReadDeadlineMs = resolveOperationDeadlineMs(
    deadlines.versionedReadDeadlineMs,
    DEFAULT_VERSIONED_READ_DEADLINE_MS,
    "Instructions S3 versioned read deadline",
  );
  const conditionalCreateAttemptDeadlineMs = resolveOperationDeadlineMs(
    deadlines.conditionalCreateAttemptDeadlineMs,
    DEFAULT_CONDITIONAL_CREATE_ATTEMPT_DEADLINE_MS,
    "Instructions S3 conditional create attempt deadline",
  );
  const existenceReconciliationDeadlineMs = resolveOperationDeadlineMs(
    deadlines.existenceReconciliationDeadlineMs,
    DEFAULT_EXISTENCE_RECONCILIATION_DEADLINE_MS,
    "Instructions S3 existence reconciliation deadline",
  );
  const client = createClient({
    bucket: config.bucket,
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(config.credentials
      ? {
          accessKeyId: config.credentials.accessKeyId,
          secretAccessKey: config.credentials.secretAccessKey,
          ...(config.credentials.sessionToken ? { sessionToken: config.credentials.sessionToken } : {}),
        }
      : {}),
    ...(config.forcePathStyle ? { virtualHostedStyle: false } : {}),
  });

  return {
    async putIfAbsent(key, bytes, options) {
      assertSafeInstructionsObjectKey(key);
      for (let attempt = 1; attempt <= CONDITIONAL_CREATE_ATTEMPTS; attempt += 1) {
        let response: Response;
        const controller = new AbortController();
        try {
          const url = client.presign(key, { method: "PUT", expiresIn: 60 });
          response = await runWithDeadline(
            () => requestFetch(url, {
              method: "PUT",
              headers: {
                "content-type": options.contentType,
                "content-md5": createHash("md5").update(bytes).digest("base64"),
                "if-none-match": "*",
              },
              body: Uint8Array.from(bytes),
              redirect: "error",
              signal: controller.signal,
            }),
            conditionalCreateAttemptDeadlineMs,
            () => controller.abort(),
          );
        } catch {
          // A connection can fail after S3 committed the object. Reconcile through
          // a bounded read only; all retries remain conditional and immutable.
          let exists = false;
          try {
            exists = await runWithDeadline(
              () => client.file(key).exists(),
              existenceReconciliationDeadlineMs,
            );
          } catch {
            // An unavailable reconciliation cannot authorize a mutable fallback.
          }
          if (exists) return { status: "existing" };
          if (attempt < CONDITIONAL_CREATE_ATTEMPTS) continue;
          throw new Error("Instructions S3 conditional object creation failed");
        }

        if (response.ok) {
          const versionId = cleanResponseVersionId(response.headers.get("x-amz-version-id"));
          void response.body?.cancel().catch(() => undefined);
          return { status: "created", ...(versionId ? { versionId } : {}) };
        }
        void response.body?.cancel().catch(() => undefined);
        if (response.status === 412) return { status: "existing" };
        if (response.status === 409 && attempt < CONDITIONAL_CREATE_ATTEMPTS) continue;
        if (response.status === 409) {
          throw new Error("Instructions S3 conditional object creation remained conflicted");
        }
        throw new Error(`Instructions S3 conditional object creation failed with status ${response.status}`);
      }
      throw new Error("Instructions S3 conditional object creation failed");
    },
    async get(key, options = {}) {
      assertSafeInstructionsObjectKey(key);
      if (options.versionId) {
        return readExactVersion(config, key, options.versionId, "GET", requestFetch, versionedReadDeadlineMs)
          .then((result) => result?.bytes);
      }
      try {
        const file = client.file(key);
        const exists = await runWithDeadline(() => file.exists(), existsDeadlineMs);
        if (!exists) return undefined;
        return Uint8Array.from(await runWithDeadline(() => file.bytes(), bytesDeadlineMs));
      } catch {
        throw new Error("Instructions S3 get operation failed");
      }
    },
    async head(key, options = {}) {
      assertSafeInstructionsObjectKey(key);
      if (options.versionId) {
        return readExactVersion(config, key, options.versionId, "HEAD", requestFetch, versionedReadDeadlineMs)
          .then((result) => result?.metadata);
      }
      try {
        const file = client.file(key);
        const exists = await runWithDeadline(() => file.exists(), existsDeadlineMs);
        if (!exists) return undefined;
        const stat = await runWithDeadline(() => file.stat(), statDeadlineMs);
        return {
          size: stat.size,
          ...(stat.etag ? { etag: stat.etag } : {}),
          ...(stat.type ? { contentType: stat.type } : {}),
          ...(stat.lastModified ? { lastModified: stat.lastModified } : {}),
        };
      } catch {
        throw new Error("Instructions S3 head operation failed");
      }
    },
  };
}

async function readExactVersion(
  config: InstructionsS3Config,
  key: string,
  versionId: string,
  method: "GET" | "HEAD",
  requestFetch: InstructionsS3Fetch,
  deadlineMs: number,
): Promise<{ bytes: Uint8Array; metadata: InstructionsObjectMetadata } | undefined> {
  assertSafeInstructionsObjectVersionId(versionId);
  const credentials = resolveRequestCredentials(config);
  const controller = new AbortController();
  try {
    const signed = signVersionedRequest(config, key, versionId, method, credentials, new Date());
    const response = await runWithDeadline(
      () => requestFetch(signed.url, {
        method,
        headers: signed.headers,
        redirect: "error",
        signal: controller.signal,
      }),
      deadlineMs,
      () => controller.abort(),
    );
    if (response.status === 404) {
      void response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("versioned S3 request failed");
    }
    const observedVersionId = cleanResponseVersionId(response.headers.get("x-amz-version-id"));
    if (observedVersionId !== versionId) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("versioned S3 response authority mismatch");
    }
    const bytes = method === "GET" ? new Uint8Array(await response.arrayBuffer()) : new Uint8Array();
    const contentLength = response.headers.get("content-length");
    const parsedSize = contentLength === null ? bytes.byteLength : Number(contentLength);
    if (!Number.isSafeInteger(parsedSize) || parsedSize < 0) throw new Error("invalid S3 content length");
    const lastModifiedValue = response.headers.get("last-modified");
    const lastModified = lastModifiedValue ? new Date(lastModifiedValue) : undefined;
    if (lastModified && !Number.isFinite(lastModified.getTime())) throw new Error("invalid S3 last modified timestamp");
    return {
      bytes,
      metadata: {
        size: parsedSize,
        versionId: observedVersionId,
        ...(response.headers.get("etag") ? { etag: response.headers.get("etag")! } : {}),
        ...(response.headers.get("content-type") ? { contentType: response.headers.get("content-type")! } : {}),
        ...(lastModified ? { lastModified } : {}),
      },
    };
  } catch {
    throw new Error(`Instructions S3 ${method === "GET" ? "get" : "head"} operation failed`);
  }
}

function resolveRequestCredentials(config: InstructionsS3Config): InstructionsS3Credentials {
  if (config.credentials) return config.credentials;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Instructions S3 exact-version reads require explicit or AWS environment credentials");
  }
  return { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) };
}

function signVersionedRequest(
  config: InstructionsS3Config,
  key: string,
  versionId: string,
  method: "GET" | "HEAD",
  credentials: InstructionsS3Credentials,
  now: Date,
): { url: string; headers: Headers } {
  const url = buildObjectUrl(config, key);
  url.searchParams.set("versionId", versionId);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = amzDate.slice(0, 8);
  const headers = new Headers({
    host: url.host,
    "x-amz-content-sha256": EMPTY_SHA256,
    "x-amz-date": amzDate,
    ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {}),
  });
  const signedHeaderNames = [
    "host",
    "x-amz-content-sha256",
    "x-amz-date",
    ...(credentials.sessionToken ? ["x-amz-security-token"] : []),
  ].sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers.get(name)!.trim()}\n`).join("");
  const canonicalQuery = `versionId=${awsEncode(versionId)}`;
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames.join(";"),
    EMPTY_SHA256,
  ].join("\n");
  const scope = `${shortDate}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, shortDate);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
  );
  return { url: url.toString(), headers };
}

function buildObjectUrl(config: InstructionsS3Config, key: string): URL {
  const encodedKey = key.split("/").map(awsEncode).join("/");
  if (config.endpoint) {
    const endpoint = new URL(config.endpoint);
    if (config.forcePathStyle) endpoint.pathname = `/${awsEncode(config.bucket)}/${encodedKey}`;
    else {
      endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
      endpoint.pathname = `/${encodedKey}`;
    }
    return endpoint;
  }
  return config.forcePathStyle
    ? new URL(`https://s3.${config.region}.amazonaws.com/${awsEncode(config.bucket)}/${encodedKey}`)
    : new URL(`https://${config.bucket}.s3.${config.region}.amazonaws.com/${encodedKey}`);
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key: string | Uint8Array, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function cleanResponseVersionId(value: string | null): string | undefined {
  const versionId = value?.trim();
  if (!versionId || versionId === "null") return undefined;
  assertSafeInstructionsObjectVersionId(versionId);
  return versionId;
}

/** In-memory object store for tests and non-network planning fixtures. */
export function memoryInstructionsObjectStore(): InstructionsAtomicObjectStore & { keys(): string[] } {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string; lastModified: Date; versionId: string }>();
  let nextVersion = 1;
  return {
    async putIfAbsent(key, bytes, options) {
      assertSafeInstructionsObjectKey(key);
      const existing = objects.get(key);
      if (existing) return { status: "existing", versionId: existing.versionId };
      const versionId = `memory-v${nextVersion++}`;
      objects.set(key, {
        bytes: Uint8Array.from(bytes),
        contentType: options.contentType,
        lastModified: new Date(),
        versionId,
      });
      return { status: "created", versionId };
    },
    async get(key, options = {}) {
      assertSafeInstructionsObjectKey(key);
      if (options.versionId) assertSafeInstructionsObjectVersionId(options.versionId);
      const object = objects.get(key);
      if (!object || (options.versionId && options.versionId !== object.versionId)) return undefined;
      return Uint8Array.from(object.bytes);
    },
    async head(key, options = {}) {
      assertSafeInstructionsObjectKey(key);
      if (options.versionId) assertSafeInstructionsObjectVersionId(options.versionId);
      const object = objects.get(key);
      return object && (!options.versionId || options.versionId === object.versionId)
        ? {
            size: object.bytes.byteLength,
            contentType: object.contentType,
            lastModified: new Date(object.lastModified),
            versionId: object.versionId,
          }
        : undefined;
    },
    keys() {
      return [...objects.keys()].sort();
    },
  };
}
