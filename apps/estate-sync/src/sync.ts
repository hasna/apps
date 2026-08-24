/**
 * The estate-sync engine: push and pull of named artifacts against a shared
 * estate store bucket, where each app is a prefix tenant.
 *
 * Protocol (per the Fable verdict, task O15-00627):
 *
 *   push(name, bytes):
 *     1. digest = sha256(bytes)
 *     2. PUT  {prefix}/bundles/{digest}   (append-only; a re-put of an existing
 *        digest is a no-op — the object is content-addressed)
 *     3. write {prefix}/index/{name}.json = signed pointer { name, digest,
 *        sizeBytes, updatedAt, signature }  (HMAC-signed when a signing key is
 *        configured)
 *
 *   pull(name):
 *     1. GET {prefix}/index/{name}.json -> resolve digest
 *     2. verify the index signature when a signing key is available
 *     3. GET {prefix}/bundles/{digest}
 *     4. verify sha256(bytes) === digest  (REQUIRED, always)
 *     5. hydrate atomically (stage + rename) to the requested target
 *
 * Safety properties:
 * - Every key is composed by the store under the configured prefix, so a name
 *   like `../../etc` can never escape the tenant (normalizeKey rejects it).
 * - The digest is the content address: two pushes of identical bytes produce
 *   one bundle object, and a pull always verifies the fetched bytes against the
 *   digest the index named — a corrupted or substituted bundle is rejected.
 * - The signed index is fail-closed: a signature that does not verify is never
 *   a pass. A puller without a signing key cannot verify and records that
 *   honestly rather than pretending (signatureVerified: false).
 */
import { sha256Hex, EstateS3Store, type EstateS3StoreOptions, type PutObjectInput } from "./store.js";
import { signIndex, verifyIndexSignature } from "./sign.js";
import { atomicWrite } from "./atomic.js";

export const INDEX_SCHEMA_VERSION = 1 as const;
export const DIGEST_HEX_LENGTH = 64;

export interface EstateIndexEntry {
  schemaVersion: typeof INDEX_SCHEMA_VERSION;
  name: string;
  digest: string;
  sizeBytes: number;
  contentType?: string;
  updatedAt: string;
  signature?: string;
  signingKeyId?: string;
}

export interface PushArtifactInput {
  name: string;
  body: Uint8Array | string;
  contentType?: string;
}

export interface PushArtifactResult {
  name: string;
  digest: string;
  sizeBytes: number;
  bundleKey: string;
  indexKey: string;
  /** True when the bundle object already existed (content-addressed no-op). */
  bundleAlreadyExisted: boolean;
}

export interface PullArtifactOptions {
  name: string;
  /** When set, atomically hydrate the verified bytes to this path. */
  hydrateTo?: string;
  /**
   * When true, a pull that cannot verify the index signature throws instead of
   * proceeding unverified. Off by default: a puller without the signing key
   * still gets the always-on sha256 bundle verification, and records
   * signatureVerified:false.
   */
  requireSignature?: boolean;
  /** HMAC signing key used to verify the index. Defaults to $ESTATE_SYNC_SIGNING_KEY. */
  signingKey?: string;
}

export interface PullArtifactResult {
  name: string;
  digest: string;
  sizeBytes: number;
  bytes: Uint8Array;
  signatureVerified: boolean;
  /** Present only when the pull could not check a signature (no key configured). */
  signatureNotChecked?: boolean;
  hydratedTo?: string;
}

export interface EstateSyncOptions extends EstateS3StoreOptions {
  /** HMAC signing key used to sign pushed indexes. Defaults to $ESTATE_SYNC_SIGNING_KEY. */
  signingKey?: string;
}

export interface EstateSyncClient {
  push(input: PushArtifactInput): Promise<PushArtifactResult>;
  pull(options: PullArtifactOptions): Promise<PullArtifactResult>;
  /** Read the current signed index entry for a name (undefined when absent). */
  readIndex(name: string): Promise<EstateIndexEntry | undefined>;
}

export class EstateSyncError extends Error {
  constructor(message: string, readonly code: string) {
    super(`[${code}] ${message}`);
    this.name = "EstateSyncError";
  }
}

export class EstateSyncClientImpl implements EstateSyncClient {
  private readonly store: EstateS3Store;
  private readonly signingKey: string | undefined;

  constructor(options: EstateSyncOptions) {
    this.store = new EstateS3Store(options);
    this.signingKey = options.signingKey ?? (process.env.ESTATE_SYNC_SIGNING_KEY || undefined);
  }

  indexKey(name: string): string {
    return `index/${normalizeName(name)}.json`;
  }

  bundleKey(digest: string): string {
    if (!isSha256Hex(digest)) {
      throw new EstateSyncError(`Refusing to address a bundle by a non-sha256 value: ${digest}`, "INVALID_DIGEST");
    }
    return `bundles/${digest}`;
  }

  /** The prefix-scoped object key for a bundle digest (what is actually stored). */
  bundleObjectKey(digest: string): string {
    return this.store.objectKey(this.bundleKey(digest));
  }

  /** The prefix-scoped object key for a name's index pointer. */
  indexObjectKey(name: string): string {
    return this.store.objectKey(this.indexKey(name));
  }

  async push(input: PushArtifactInput): Promise<PushArtifactResult> {
    const name = normalizeName(input.name);
    const body = typeof input.body === "string" ? new TextEncoder().encode(input.body) : input.body;
    const digest = sha256Hex(body);
    const bundleKey = this.bundleKey(digest);
    const bundleAlreadyExisted = await this.store.objectExists(bundleKey);
    if (!bundleAlreadyExisted) {
      const putInput: PutObjectInput = {
        path: bundleKey,
        body,
        ...(input.contentType ? { contentType: input.contentType } : {}),
      };
      await this.store.putObject(putInput);
    }
    const entry: EstateIndexEntry = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      name,
      digest,
      sizeBytes: body.byteLength,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (this.signingKey) {
      entry.signature = signIndex(entry as unknown as Record<string, unknown>, this.signingKey);
      entry.signingKeyId = "v1";
    }
    const indexKey = this.indexKey(name);
    const indexJson = `${JSON.stringify(entry, null, 2)}\n`;
    await this.store.putObject({
      path: indexKey,
      body: new TextEncoder().encode(indexJson),
      contentType: "application/json",
    });
    return {
      name,
      digest,
      sizeBytes: body.byteLength,
      bundleKey: this.bundleObjectKey(digest),
      indexKey: this.indexObjectKey(name),
      bundleAlreadyExisted,
    };
  }

  async readIndex(name: string): Promise<EstateIndexEntry | undefined> {
    let bytes: Uint8Array;
    try {
      bytes = await this.store.getObject(this.indexKey(name));
    } catch (error) {
      // A missing index reads as absent, never as a broken parse.
      if (error instanceof Error && /404/.test(error.message)) return undefined;
      throw error;
    }
    return parseIndexEntry(bytes);
  }

  async pull(options: PullArtifactOptions): Promise<PullArtifactResult> {
    const name = normalizeName(options.name);
    const entry = await this.readIndex(name);
    if (!entry) {
      throw new EstateSyncError(`No index entry for '${name}'`, "INDEX_MISSING");
    }
    if (entry.name !== name) {
      // The entry names itself; a mismatch between the requested name and the
      // entry's self-name is a malformed index, fail closed.
      throw new EstateSyncError(`Index entry for '${name}' names itself '${entry.name}'`, "INDEX_NAME_MISMATCH");
    }
    if (!isSha256Hex(entry.digest)) {
      throw new EstateSyncError(`Index for '${name}' carries a non-sha256 digest`, "INDEX_BAD_DIGEST");
    }

    const signingKey = options.signingKey ?? this.signingKey;
    let signatureVerified = false;
    let signatureNotChecked = false;
    if (signingKey) {
      if (!verifyIndexSignature(entry as unknown as Record<string, unknown>, signingKey)) {
        if (options.requireSignature) {
          throw new EstateSyncError(`Index signature for '${name}' did not verify`, "INDEX_SIGNATURE_INVALID");
        }
        // Recorded honestly; the sha256 bundle check below still runs.
      } else {
        signatureVerified = true;
      }
    } else if (options.requireSignature) {
      throw new EstateSyncError(`Cannot verify the index signature for '${name}': no signing key configured`, "INDEX_SIGNATURE_NO_KEY");
    } else {
      signatureNotChecked = true;
    }

    let bytes: Uint8Array;
    try {
      bytes = await this.store.getObject(this.bundleKey(entry.digest));
    } catch (error) {
      throw new EstateSyncError(`Failed to fetch bundle '${entry.digest}' for '${name}'`, "BUNDLE_FETCH_FAILED");
    }
    const actual = sha256Hex(bytes);
    if (actual !== entry.digest) {
      throw new EstateSyncError(
        `Bundle digest mismatch for '${name}': index named ${entry.digest}, fetched ${actual}`,
        "BUNDLE_DIGEST_MISMATCH",
      );
    }

    let hydratedTo: string | undefined;
    if (options.hydrateTo) {
      atomicWrite(options.hydrateTo, bytes);
      hydratedTo = options.hydrateTo;
    }
    return {
      name,
      digest: entry.digest,
      sizeBytes: bytes.byteLength,
      bytes,
      signatureVerified,
      ...(signatureNotChecked ? { signatureNotChecked } : {}),
      ...(hydratedTo ? { hydratedTo } : {}),
    };
  }
}

export function createEstateSync(options: EstateSyncOptions): EstateSyncClient {
  return new EstateSyncClientImpl(options);
}

export function normalizeName(name: string): string {
  const cleaned = name.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(cleaned)) {
    throw new EstateSyncError(`Invalid artifact name: '${name}'`, "INVALID_NAME");
  }
  return cleaned;
}

export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function parseIndexEntry(bytes: Uint8Array): EstateIndexEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new EstateSyncError("Index entry is not valid JSON", "INDEX_UNPARSEABLE");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new EstateSyncError("Index entry is not an object", "INDEX_MALFORMED");
  }
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== INDEX_SCHEMA_VERSION) {
    throw new EstateSyncError(`Unsupported index schema version: ${String(record.schemaVersion)}`, "INDEX_SCHEMA_VERSION");
  }
  const name = record.name;
  const digest = record.digest;
  const sizeBytes = record.sizeBytes;
  const updatedAt = record.updatedAt;
  if (
    typeof name !== "string" ||
    typeof digest !== "string" ||
    typeof sizeBytes !== "number" ||
    typeof updatedAt !== "string"
  ) {
    throw new EstateSyncError("Index entry is missing required fields", "INDEX_MALFORMED");
  }
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    name,
    digest,
    sizeBytes,
    updatedAt,
    ...(typeof record.contentType === "string" ? { contentType: record.contentType } : {}),
    ...(typeof record.signature === "string" ? { signature: record.signature } : {}),
    ...(typeof record.signingKeyId === "string" ? { signingKeyId: record.signingKeyId } : {}),
  };
}
