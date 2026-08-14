import { createHash, createHmac } from "node:crypto";
import type { TodosS3StorageConfig } from "./config.js";

export interface TodosAwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface TodosS3ArtifactStoreOptions {
  config: TodosS3StorageConfig;
  credentials: TodosAwsCredentials;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface PutTodosS3ObjectInput {
  key: string;
  body: BodyInit | Uint8Array | string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface TodosS3ObjectRef {
  bucket: string;
  key: string;
  url: string;
  etag?: string;
}

export interface TodosS3ArtifactStore {
  objectKey(relativePath: string): string;
  objectUrl(relativePath: string): URL;
  putObject(input: PutTodosS3ObjectInput): Promise<TodosS3ObjectRef>;
  getObject(relativePath: string): Promise<Response>;
  deleteObject(relativePath: string): Promise<void>;
}

export function createTodosS3ArtifactStore(options: TodosS3ArtifactStoreOptions): TodosS3ArtifactStore {
  const requestFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  return {
    objectKey: (relativePath) => buildS3ObjectKey(options.config, relativePath),
    objectUrl: (relativePath) => buildS3ObjectUrl(options.config, buildS3ObjectKey(options.config, relativePath)),
    async putObject(input) {
      const key = buildS3ObjectKey(options.config, input.key);
      const url = buildS3ObjectUrl(options.config, key);
      const body = normalizeBody(input.body);
      const headers: Record<string, string> = {
        "content-type": input.contentType ?? "application/octet-stream",
      };
      for (const [name, value] of Object.entries(input.metadata ?? {})) {
        headers[`x-amz-meta-${name.toLowerCase()}`] = value;
      }
      const signed = signAwsV4Request({
        method: "PUT",
        url,
        region: options.config.region ?? "us-east-1",
        service: "s3",
        headers,
        body,
        credentials: options.credentials,
        now: now(),
      });
      const response = await requestFetch(url, { method: "PUT", headers: signed.headers, body: body as unknown as BodyInit });
      if (!response.ok) throw new Error(`S3 put failed with HTTP ${response.status}`);
      return {
        bucket: options.config.bucket,
        key,
        url: url.toString(),
        etag: response.headers.get("etag") ?? undefined,
      };
    },
    async getObject(relativePath) {
      const url = buildS3ObjectUrl(options.config, buildS3ObjectKey(options.config, relativePath));
      const signed = signAwsV4Request({
        method: "GET",
        url,
        region: options.config.region ?? "us-east-1",
        service: "s3",
        headers: {},
        credentials: options.credentials,
        now: now(),
      });
      const response = await requestFetch(url, { method: "GET", headers: signed.headers });
      if (!response.ok) throw new Error(`S3 get failed with HTTP ${response.status}`);
      return response;
    },
    async deleteObject(relativePath) {
      const url = buildS3ObjectUrl(options.config, buildS3ObjectKey(options.config, relativePath));
      const signed = signAwsV4Request({
        method: "DELETE",
        url,
        region: options.config.region ?? "us-east-1",
        service: "s3",
        headers: {},
        credentials: options.credentials,
        now: now(),
      });
      const response = await requestFetch(url, { method: "DELETE", headers: signed.headers });
      if (!response.ok && response.status !== 404) throw new Error(`S3 delete failed with HTTP ${response.status}`);
    },
  };
}

export function buildS3ObjectKey(config: Pick<TodosS3StorageConfig, "prefix">, relativePath: string): string {
  const prefix = normalizeS3Prefix(config.prefix);
  const key = normalizeS3Key(relativePath);
  return `${prefix}${key}`;
}

export function buildS3ObjectUrl(config: TodosS3StorageConfig, key: string): URL {
  const encodedKey = encodeS3Path(key);
  if (config.endpoint || config.forcePathStyle) {
    const base = new URL(config.endpoint ?? `https://s3.${config.region ?? "us-east-1"}.amazonaws.com`);
    base.pathname = `${trimTrailingSlash(base.pathname)}/${encodeURIComponent(config.bucket)}/${encodedKey}`;
    return base;
  }
  return new URL(`https://${config.bucket}.s3.${config.region ?? "us-east-1"}.amazonaws.com/${encodedKey}`);
}

export interface SignAwsV4RequestInput {
  method: string;
  url: URL;
  region: string;
  service: string;
  headers?: Record<string, string>;
  body?: Uint8Array;
  credentials: TodosAwsCredentials;
  now: Date;
}

export interface SignedAwsV4Request {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
}

export function signAwsV4Request(input: SignAwsV4RequestInput): SignedAwsV4Request {
  const amzDate = toAmzDate(input.now);
  const dateStamp = amzDate.slice(0, 8);
  const bodyHash = sha256Hex(input.body ?? new Uint8Array());
  const headers = normalizeHeaders({
    ...(input.headers ?? {}),
    host: input.url.host,
    "x-amz-content-sha256": bodyHash,
    "x-amz-date": amzDate,
    ...(input.credentials.sessionToken ? { "x-amz-security-token": input.credentials.sessionToken } : {}),
  });
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]}\n`)
    .join("");
  const canonicalRequest = [
    input.method.toUpperCase(),
    input.url.pathname || "/",
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSigningKey(input.credentials.secretAccessKey, dateStamp, input.region, input.service);
  const signature = hmacHex(signingKey, stringToSign);

  return {
    headers: {
      ...headers,
      authorization: [
        `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}`,
        `SignedHeaders=${signedHeaders}`,
        `Signature=${signature}`,
      ].join(", "),
    },
    canonicalRequest,
    stringToSign,
  };
}

function normalizeBody(body: BodyInit | Uint8Array | string): Uint8Array {
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new Error("S3 body must be a string, Uint8Array, Buffer, or ArrayBuffer");
}

function normalizeS3Prefix(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) throw new Error("Invalid S3 object key");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizeS3Key(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.endsWith("/")) throw new Error("Invalid S3 object key");
  return normalized;
}

function encodeS3Path(key: string): string {
  return key
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const entries: Array<[string, string]> = Object.entries(headers).map(([name, value]) => [
    name.toLowerCase(),
    value.trim().replace(/\s+/g, " "),
  ]);
  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return Object.fromEntries(entries);
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

function getSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const dateRegionKey = hmac(dateKey, region);
  const dateRegionServiceKey = hmac(dateRegionKey, service);
  return hmac(dateRegionServiceKey, "aws4_request");
}
