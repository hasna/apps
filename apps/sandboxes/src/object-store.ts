import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  assertDigest,
  assertRfc3339,
  canonicalDigest,
  canonicalJson,
  nowRfc3339,
  sha256,
  type Digest,
} from "./canonical.js";
import { SandboxError } from "./errors.js";

export type SandboxObjectDataClassV1 =
  | "public"
  | "internal_non_sensitive"
  | "restricted";

export interface SandboxObjectPutV1 {
  bytes: Uint8Array;
  expected_sha256: Digest;
  max_bytes: number;
  retention_until: string;
  data_class: SandboxObjectDataClassV1;
}

export interface SandboxObjectReadV1 {
  object_sha256: Digest;
  object_version: string;
  max_bytes: number;
}

export interface SandboxObjectReceiptV1 {
  schema_version: "sandboxes.object-receipt/v1";
  backend: "local_encrypted" | "self_hosted_versioned";
  object_sha256: Digest;
  object_version: string;
  size_bytes: number;
  stored_at: string;
  retention_until: string;
  data_class: SandboxObjectDataClassV1;
  receipt_sha256: Digest;
}

export interface SandboxObjectStoreV1 {
  put(input: SandboxObjectPutV1): Promise<SandboxObjectReceiptV1>;
  read(input: SandboxObjectReadV1): Promise<Uint8Array>;
}

const LOCAL_MAGIC = new TextEncoder().encode("SBXOBJ1\n");
const LOCAL_HEADER_MAX = 4_096;

interface LocalObjectHeaderV1 {
  schema_version: "sandboxes.local-object/v1";
  object_sha256: Digest;
  size_bytes: number;
  stored_at: string;
  retention_until: string;
  data_class: SandboxObjectDataClassV1;
  key_version: string;
}

export interface LocalEncryptedObjectStoreOptionsV1 {
  root: string;
  key: Uint8Array;
  key_version: string;
  allow_unsafe_test_path?: boolean;
  clock?: () => Date;
}

function positiveBound(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SandboxError("validation_failed", `${field} must be a positive safe integer`);
  }
}

function validatePut(input: SandboxObjectPutV1): void {
  assertDigest(input.expected_sha256, "object.expected_sha256");
  positiveBound(input.max_bytes, "object.max_bytes");
  assertRfc3339(input.retention_until, "object.retention_until");
  if (!(["public", "internal_non_sensitive", "restricted"] as const).includes(input.data_class)) {
    throw new SandboxError("validation_failed", "object.data_class is not allowed");
  }
  if (input.bytes.byteLength > input.max_bytes) {
    throw new SandboxError("validation_failed", "Object exceeds its byte cap");
  }
  if (sha256(input.bytes) !== input.expected_sha256) {
    throw new SandboxError("integrity_failed", "Object bytes do not match expected digest");
  }
}

function validateRead(input: SandboxObjectReadV1): void {
  assertDigest(input.object_sha256, "object.object_sha256");
  positiveBound(input.max_bytes, "object.max_bytes");
  if (
    typeof input.object_version !== "string" ||
    input.object_version.length < 1 ||
    input.object_version.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(input.object_version)
  ) {
    throw new SandboxError("validation_failed", "object.object_version is invalid");
  }
}

function secureRoot(root: string, allowUnsafe: boolean): string {
  const absolute = resolve(root);
  let cursor = absolute;
  while (true) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new SandboxError("integrity_failed", "Object-store path ancestry cannot contain symlinks");
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (!existsSync(absolute)) mkdirSync(absolute, { recursive: true, mode: 0o700 });
  const info = lstatSync(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new SandboxError("integrity_failed", "Object-store root must be a real directory");
  }
  if (!allowUnsafe) {
    const uid = typeof process.getuid === "function" ? process.getuid() : info.uid;
    if (info.uid !== uid || (info.mode & 0o077) !== 0) {
      throw new SandboxError("forbidden", "Object-store root must be owner-controlled mode 0700");
    }
  }
  chmodSync(absolute, 0o700);
  return absolute;
}

function receipt(
  protectedBytes: Omit<SandboxObjectReceiptV1, "receipt_sha256">,
): SandboxObjectReceiptV1 {
  return { ...protectedBytes, receipt_sha256: canonicalDigest(protectedBytes) };
}

export class LocalEncryptedObjectStoreV1 implements SandboxObjectStoreV1 {
  readonly #root: string;
  readonly #key: Uint8Array;
  readonly #keyVersion: string;
  readonly #clock: () => Date;

  constructor(options: LocalEncryptedObjectStoreOptionsV1) {
    if (options.key.byteLength !== 32) {
      throw new SandboxError("validation_failed", "Local object encryption key must be 32 bytes");
    }
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(options.key_version)) {
      throw new SandboxError("validation_failed", "Local object key version is invalid");
    }
    this.#root = secureRoot(options.root, options.allow_unsafe_test_path === true);
    this.#key = Uint8Array.from(options.key);
    this.#keyVersion = options.key_version;
    this.#clock = options.clock ?? (() => new Date());
  }

  async put(input: SandboxObjectPutV1): Promise<SandboxObjectReceiptV1> {
    validatePut(input);
    const now = this.#clock();
    if (Date.parse(input.retention_until) <= now.getTime()) {
      throw new SandboxError("validation_failed", "Object retention must be in the future");
    }
    const header: LocalObjectHeaderV1 = {
      schema_version: "sandboxes.local-object/v1",
      object_sha256: input.expected_sha256,
      size_bytes: input.bytes.byteLength,
      stored_at: nowRfc3339(now),
      retention_until: input.retention_until,
      data_class: input.data_class,
      key_version: this.#keyVersion,
    };
    const headerBytes = new TextEncoder().encode(canonicalJson(header));
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(headerBytes);
    const encrypted = Buffer.concat([cipher.update(input.bytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    const length = Buffer.alloc(4);
    length.writeUInt32BE(headerBytes.byteLength);
    const payload = Buffer.concat([
      LOCAL_MAGIC,
      length,
      headerBytes,
      nonce,
      tag,
      encrypted,
    ]);
    const path = this.#path(input.expected_sha256);
    this.#assertObjectPath(path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.#assertObjectPath(path);
    chmodSync(dirname(path), 0o700);
    if (existsSync(path)) {
      const existing = this.#open(path, input.max_bytes);
      if (
        existing.header.object_sha256 !== header.object_sha256 ||
        existing.header.size_bytes !== header.size_bytes ||
        existing.header.retention_until !== header.retention_until ||
        existing.header.data_class !== header.data_class ||
        existing.header.key_version !== header.key_version ||
        sha256(existing.bytes) !== input.expected_sha256
      ) {
        throw new SandboxError("integrity_failed", "Content-addressed object identity has conflicting bytes or metadata");
      }
      const version = sha256(readFileSync(path));
      return receipt({
        schema_version: "sandboxes.object-receipt/v1",
        backend: "local_encrypted",
        object_sha256: input.expected_sha256,
        object_version: version,
        size_bytes: input.bytes.byteLength,
        stored_at: existing.header.stored_at,
        retention_until: input.retention_until,
        data_class: input.data_class,
      });
    }
    const temporary = `${path}.tmp-${randomBytes(12).toString("hex")}`;
    const temporaryFd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(temporaryFd, payload);
      fsyncSync(temporaryFd);
    } finally {
      closeSync(temporaryFd);
    }
    chmodSync(temporary, 0o600);
    try {
      linkSync(temporary, path);
      chmodSync(path, 0o600);
      const directoryFd = openSync(dirname(path), "r");
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    } catch (error) {
      if (!existsSync(path)) throw error;
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    const durable = this.#open(path, input.max_bytes);
    if (
      canonicalDigest(durable.header) !== canonicalDigest(header) ||
      sha256(durable.bytes) !== input.expected_sha256
    ) {
      throw new SandboxError("integrity_failed", "Local object read-after-write verification failed");
    }
    return receipt({
      schema_version: "sandboxes.object-receipt/v1",
      backend: "local_encrypted",
      object_sha256: input.expected_sha256,
      object_version: sha256(readFileSync(path)),
      size_bytes: input.bytes.byteLength,
      stored_at: header.stored_at,
      retention_until: input.retention_until,
      data_class: input.data_class,
    });
  }

  async read(input: SandboxObjectReadV1): Promise<Uint8Array> {
    validateRead(input);
    const path = this.#path(input.object_sha256);
    this.#assertObjectPath(path);
    if (!existsSync(path)) throw new SandboxError("not_found", "Object was not found");
    const encodedBytes = readFileSync(path);
    if (sha256(encodedBytes) !== input.object_version) {
      throw new SandboxError("integrity_failed", "Object version does not match immutable encrypted bytes");
    }
    const opened = this.#open(path, input.max_bytes);
    if (opened.header.object_sha256 !== input.object_sha256) {
      throw new SandboxError("integrity_failed", "Object header digest mismatch");
    }
    return opened.bytes;
  }

  #path(digest: Digest): string {
    const hex = digest.slice("sha256:".length);
    return join(this.#root, "objects", "sha256", hex.slice(0, 2), `${hex}.object`);
  }

  #assertObjectPath(path: string): void {
    if (!path.startsWith(`${this.#root}${sep}`)) {
      throw new SandboxError("integrity_failed", "Object path escaped its configured root");
    }
    let cursor = dirname(path);
    while (cursor.length >= this.#root.length) {
      if (existsSync(cursor)) {
        const info = lstatSync(cursor);
        if (!info.isDirectory() || info.isSymbolicLink()) {
          throw new SandboxError("integrity_failed", "Object path ancestry must contain only real directories");
        }
        if ((info.mode & 0o077) !== 0) {
          throw new SandboxError("forbidden", "Object path ancestry must remain owner-private");
        }
      }
      if (cursor === this.#root) break;
      cursor = dirname(cursor);
    }
  }

  #open(path: string, maxBytes: number): { header: LocalObjectHeaderV1; bytes: Uint8Array } {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
      throw new SandboxError("integrity_failed", "Object path must be a private regular file");
    }
    const payload = readFileSync(path);
    if (
      payload.byteLength < LOCAL_MAGIC.byteLength + 4 + 12 + 16 ||
      !payload.subarray(0, LOCAL_MAGIC.byteLength).equals(LOCAL_MAGIC)
    ) {
      throw new SandboxError("integrity_failed", "Encrypted object framing is invalid");
    }
    const headerLength = payload.readUInt32BE(LOCAL_MAGIC.byteLength);
    if (headerLength < 1 || headerLength > LOCAL_HEADER_MAX) {
      throw new SandboxError("integrity_failed", "Encrypted object header length is invalid");
    }
    const headerStart = LOCAL_MAGIC.byteLength + 4;
    const nonceStart = headerStart + headerLength;
    const tagStart = nonceStart + 12;
    const bodyStart = tagStart + 16;
    if (bodyStart > payload.byteLength) {
      throw new SandboxError("integrity_failed", "Encrypted object framing is truncated");
    }
    const headerBytes = payload.subarray(headerStart, nonceStart);
    let header: LocalObjectHeaderV1;
    try {
      header = JSON.parse(headerBytes.toString("utf8")) as LocalObjectHeaderV1;
    } catch {
      throw new SandboxError("integrity_failed", "Encrypted object header is not canonical JSON");
    }
    if (
      canonicalJson(header) !== headerBytes.toString("utf8") ||
      header.schema_version !== "sandboxes.local-object/v1" ||
      header.key_version !== this.#keyVersion ||
      !Number.isSafeInteger(header.size_bytes) ||
      header.size_bytes < 0 ||
      header.size_bytes > maxBytes
    ) {
      throw new SandboxError("integrity_failed", "Encrypted object header is invalid or exceeds the read cap");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#key,
        payload.subarray(nonceStart, tagStart),
      );
      decipher.setAAD(headerBytes);
      decipher.setAuthTag(payload.subarray(tagStart, bodyStart));
      const bytes = Buffer.concat([
        decipher.update(payload.subarray(bodyStart)),
        decipher.final(),
      ]);
      if (bytes.byteLength !== header.size_bytes || sha256(bytes) !== header.object_sha256) {
        throw new SandboxError("integrity_failed", "Decrypted object bytes do not match their header");
      }
      return { header, bytes };
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      throw new SandboxError("integrity_failed", "Encrypted object authentication failed");
    }
  }
}

export interface VersionedObjectSinkV1 {
  put(input: {
    key: string;
    bytes: Uint8Array;
    checksum_sha256: Digest;
    kms_key_ref: string;
    retention_until: string;
  }): Promise<{
    version_id: string;
    checksum_sha256: Digest;
    encryption: "aws:kms";
    kms_key_ref: string;
  }>;
  head(input: { key: string; version_id: string }): Promise<{
    version_id: string;
    checksum_sha256: Digest;
    size_bytes: number;
    encryption: "aws:kms";
    kms_key_ref: string;
  }>;
  get(input: { key: string; version_id: string; max_bytes: number }): Promise<Uint8Array>;
}

export interface SelfHostedVersionedObjectStoreOptionsV1 {
  sink: VersionedObjectSinkV1;
  namespace: string;
  kms_key_ref: string;
  clock?: () => Date;
}

export class SelfHostedVersionedObjectStoreV1 implements SandboxObjectStoreV1 {
  readonly #sink: VersionedObjectSinkV1;
  readonly #namespace: string;
  readonly #kmsKeyRef: string;
  readonly #clock: () => Date;

  constructor(options: SelfHostedVersionedObjectStoreOptionsV1) {
    if (!/^[a-z0-9][a-z0-9/_-]{0,127}$/.test(options.namespace)) {
      throw new SandboxError("validation_failed", "Object namespace is invalid");
    }
    if (!/^[a-zA-Z0-9:/._-]{1,256}$/.test(options.kms_key_ref)) {
      throw new SandboxError("validation_failed", "KMS key reference is invalid");
    }
    this.#sink = options.sink;
    this.#namespace = options.namespace.replace(/\/$/, "");
    this.#kmsKeyRef = options.kms_key_ref;
    this.#clock = options.clock ?? (() => new Date());
  }

  async put(input: SandboxObjectPutV1): Promise<SandboxObjectReceiptV1> {
    validatePut(input);
    const storedAt = nowRfc3339(this.#clock());
    if (Date.parse(input.retention_until) <= Date.parse(storedAt)) {
      throw new SandboxError("validation_failed", "Object retention must be in the future");
    }
    const key = this.#key(input.expected_sha256);
    const stored = await this.#sink.put({
      key,
      bytes: input.bytes,
      checksum_sha256: input.expected_sha256,
      kms_key_ref: this.#kmsKeyRef,
      retention_until: input.retention_until,
    });
    const head = await this.#sink.head({ key, version_id: stored.version_id });
    if (
      typeof stored.version_id !== "string" ||
      stored.version_id.length < 1 ||
      stored.version_id.length > 256 ||
      /[\u0000-\u001f\u007f]/u.test(stored.version_id) ||
      stored.checksum_sha256 !== input.expected_sha256 ||
      stored.encryption !== "aws:kms" ||
      stored.kms_key_ref !== this.#kmsKeyRef ||
      head.version_id !== stored.version_id ||
      head.checksum_sha256 !== input.expected_sha256 ||
      head.size_bytes !== input.bytes.byteLength ||
      head.encryption !== "aws:kms" ||
      head.kms_key_ref !== this.#kmsKeyRef
    ) {
      throw new SandboxError("integrity_failed", "Versioned object read-after-write proof mismatch");
    }
    return receipt({
      schema_version: "sandboxes.object-receipt/v1",
      backend: "self_hosted_versioned",
      object_sha256: input.expected_sha256,
      object_version: stored.version_id,
      size_bytes: input.bytes.byteLength,
      stored_at: storedAt,
      retention_until: input.retention_until,
      data_class: input.data_class,
    });
  }

  async read(input: SandboxObjectReadV1): Promise<Uint8Array> {
    validateRead(input);
    const bytes = await this.#sink.get({
      key: this.#key(input.object_sha256),
      version_id: input.object_version,
      max_bytes: input.max_bytes,
    });
    if (bytes.byteLength > input.max_bytes || sha256(bytes) !== input.object_sha256) {
      throw new SandboxError("integrity_failed", "Versioned object bytes failed checksum or size verification");
    }
    return bytes;
  }

  #key(digest: Digest): string {
    const hex = digest.slice("sha256:".length);
    return `${this.#namespace}/sha256/${hex.slice(0, 2)}/${hex}`;
  }
}
