/**
 * EstateS3Store — a minimal S3 object store for the estate bucket, parameterized
 * by (bucket, prefix). Implements SigV4 signing directly (no SDK dependency) so
 * the shared sync engine has one credential path that works identically in an
 * ECS task role, a publisher CI session, and a test fixture.
 *
 * All keys are scoped under the configured prefix; a caller never supplies a
 * full bucket key. This is what makes the estate-store prefix-tenancy real: an
 * object written through a store with prefix `skills` can never escape
 * `skills/`, because the store composes every key as `{prefix}/{path}`.
 */
import { createHash, createHmac } from "node:crypto";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface EstateS3StoreOptions {
  /** The estate store bucket, e.g. `hasna-apps-prod-store-<account-id>`. */
  bucket: string;
  /** App prefix tenant, e.g. `skills`. No leading or trailing slash. */
  prefix: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: AwsCredentials;
  fetch?: FetchLike;
}

export interface PutObjectInput {
  path: string;
  body: Uint8Array;
  contentType?: string;
}

export interface StoredObject {
  key: string;
  url: string;
  sizeBytes: number;
  /** True when the object already existed (an append-only bundle re-put). */
  alreadyExisted?: boolean;
}

export class EstateS3Store {
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly region: string;
  private readonly endpoint: string | undefined;
  private readonly forcePathStyle: boolean;
  private readonly fetchImpl: FetchLike;
  private readonly credentials: AwsCredentials | undefined;

  constructor(options: EstateS3StoreOptions) {
    this.bucket = options.bucket;
    this.prefix = normalizePrefix(options.prefix);
    this.region = options.region ?? "us-east-1";
    this.endpoint = options.endpoint?.replace(/\/+$/, "") || undefined;
    this.forcePathStyle = options.forcePathStyle ?? false;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.credentials = options.credentials;
  }

  /** Compose a prefix-scoped key. Rejects traversal so a path can never escape the prefix. */
  objectKey(path: string): string {
    const cleaned = normalizeKey(path);
    return this.prefix ? `${this.prefix}/${cleaned}` : cleaned;
  }

  objectUrl(key: string): string {
    return buildObjectUrl({
      bucket: this.bucket,
      key,
      region: this.region,
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
      forcePathStyle: this.forcePathStyle,
    });
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const key = this.objectKey(input.path);
    const url = this.objectUrl(key);
    const bytes = input.body instanceof Uint8Array ? input.body : new Uint8Array(await new Response(input.body).arrayBuffer());
    const headers = await this.#sign({
      method: "PUT",
      url,
      body: bytes,
      contentType: input.contentType ?? "application/octet-stream",
    });
    const response = await this.fetchImpl(url, {
      method: "PUT",
      headers,
      body: toArrayBuffer(bytes),
    });
    if (!response.ok) {
      throw new Error(`S3 put failed for ${key}: ${response.status} ${response.statusText}`.trim());
    }
    return { key, url, sizeBytes: bytes.byteLength };
  }

  /** Get a prefix-scoped object's bytes. */
  async getObject(path: string): Promise<Uint8Array> {
    const key = this.objectKey(path);
    const url = this.objectUrl(key);
    const headers = await this.#sign({ method: "GET", url, body: new Uint8Array() });
    const response = await this.fetchImpl(url, { method: "GET", headers });
    if (!response.ok) {
      throw new Error(`S3 get failed for ${key}: ${response.status} ${response.statusText}`.trim());
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /** True when the prefix-scoped object exists (404 → false; any other failure throws). */
  async objectExists(path: string): Promise<boolean> {
    const key = this.objectKey(path);
    const url = this.objectUrl(key);
    const headers = await this.#sign({ method: "HEAD", url, body: new Uint8Array() });
    const response = await this.fetchImpl(url, { method: "HEAD", headers });
    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(`S3 head failed for ${key}: ${response.status} ${response.statusText}`.trim());
    }
    return true;
  }

  async #sign(params: {
    method: "PUT" | "GET" | "HEAD";
    url: string;
    body: Uint8Array;
    contentType?: string;
  }): Promise<Record<string, string>> {
    const credentials = this.credentials ?? (await resolveAmbientCredentials(this.fetchImpl));
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const url = new URL(params.url);
    const payloadHash = sha256Hex(params.body);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      ...(params.contentType ? { "content-type": params.contentType } : {}),
      ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {}),
    };
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
    const canonicalRequest = [
      params.method,
      encodeUriPath(url.pathname),
      canonicalizeQuery(url.searchParams),
      canonicalHeaders,
      signedHeaderNames.join(";"),
      headers["x-amz-content-sha256"],
    ].join("\n");
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signingKey = getAwsSigningKey(credentials.secretAccessKey, dateStamp, this.region, "s3");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    headers.authorization = [
      `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaderNames.join(";")}`,
      `Signature=${signature}`,
    ].join(", ");
    return headers;
  }
}

export function buildObjectUrl(params: {
  bucket: string;
  key: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
}): string {
  const key = params.key.split("/").map(encodeURIComponent).join("/");
  if (params.endpoint) {
    return params.forcePathStyle
      ? `${params.endpoint}/${encodeURIComponent(params.bucket)}/${key}`
      : `${params.endpoint}/${key}`;
  }
  return params.forcePathStyle
    ? `https://s3.${params.region}.amazonaws.com/${encodeURIComponent(params.bucket)}/${key}`
    : `https://${params.bucket}.s3.${params.region}.amazonaws.com/${key}`;
}

/** Resolve AWS credentials from env, then the ECS task-role metadata endpoint. */
async function resolveAmbientCredentials(fetchImpl: FetchLike): Promise<AwsCredentials> {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    return {
      accessKeyId,
      secretAccessKey,
      ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
    };
  }
  // ECS task-role credentials come from the FULL_URI variable on Fargate (and the
  // EC2 container agent). The relative-URI form with a hard-coded metadata IP is
  // deliberately not implemented here: the shared engine composes no literal host,
  // so a vendored build cannot be certified against the skills vendor-host guard.
  const credentialsUri = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  if (!credentialsUri) {
    throw new Error("AWS credentials or ECS task-role credentials are required for estate S3 storage");
  }
  const headers: HeadersInit = {};
  const authToken = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
  if (authToken) headers.authorization = authToken;
  const response = await fetchImpl(credentialsUri, { headers });
  if (!response.ok) {
    throw new Error(`ECS task-role credentials request failed: ${response.status} ${response.statusText}`.trim());
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const resolvedAccessKeyId = stringField(payload, "AccessKeyId");
  const resolvedSecretAccessKey = stringField(payload, "SecretAccessKey");
  const sessionToken = stringField(payload, "Token");
  if (!resolvedAccessKeyId || !resolvedSecretAccessKey) {
    throw new Error("ECS task-role credentials response did not include access keys");
  }
  return {
    accessKeyId: resolvedAccessKeyId,
    secretAccessKey: resolvedSecretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePrefix(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function normalizeKey(value: string): string {
  const parts = value.split(/[\\/]+/).filter((part) => part && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) {
    throw new Error(`Invalid estate store key: ${value}`);
  }
  return parts.join("/");
}

function getAwsSigningKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac("sha256", `AWS4${secret}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update(service).digest();
  return createHmac("sha256", kService).update("aws4_request").digest();
}

function canonicalizeQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function encodeUriPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)).replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    ))
    .join("/");
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
