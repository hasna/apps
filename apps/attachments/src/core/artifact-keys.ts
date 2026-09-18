/**
 * Canonical artifact key layout for the attachments S3 object store.
 *
 * Adopted from the artifact-remote kit key layout (hasna/apps#1631,
 * implemented first by the skills app in hasna/apps#1639):
 *
 *   <kind>/<owner>/<sha256>[.<ext>]            content-addressed object
 *   <kind>/<owner>/manifests/<id>.json         immutable manifest pointing at the object
 *
 * - kind = `attachments` (the app namespace; one bucket policy/lifecycle
 *   covers it).
 * - owner = `global` — structural, never optional. The attachments store is
 *   single-tenant per deployment, so the owner segment is a fixed constant
 *   that a bucket policy or lifecycle rule can key on; it exists so a future
 *   tenant split never collides keys.
 * - sha256 = lowercase hex digest of the bytes actually stored (the ciphertext
 *   when an upload is encrypted — encryption re-keys the content, so a
 *   password-encrypted duplicate is a distinct object, which is correct).
 *
 * Properties:
 * - Duplicate uploads of identical bytes land on the SAME key: a repeat PUT is
 *   an idempotent overwrite, never a second object. Upload paths short-circuit
 *   with a HEAD when the store supports it.
 * - The manifest is per attachment id (immutable identity, like the kit's
 *   named versions), so every row remains individually addressable and a
 *   bucket listing is restorable without the database.
 *
 * Legacy keys (`attachments/YYYY-MM-DD/att_<id>/<random>[.<ext>]`, with a
 * sibling `.sha256` sidecar object) remain readable for the whole migration
 * window: rows persist their own `s3Key` and every read path resolves it
 * verbatim. `isLegacyObjectKey`/`isStagingKey` classify stored keys so tooling
 * can report which layout an object lives under.
 */

import { createHash } from "crypto";
import { createReadStream } from "fs";
import { extname } from "path";

/** Kind segment: the app namespace. Fixed so one bucket policy covers the store. */
export const ATTACHMENTS_KIND = "attachments";
/** Owner segment: structural single-tenant constant (see module doc). */
export const ATTACHMENTS_OWNER = "global";
/** Staging namespace for uploads whose content digest is not known up front (presigned/public PUTs). */
export const STAGING_NAMESPACE = "uploads";
/** Manifest namespace, sibling to the blobs under the same kind/owner. */
export const MANIFEST_NAMESPACE = "manifests";

/** Canonical manifest schema identifier (not a URL; no infra identity). */
export const ARTIFACT_MANIFEST_SCHEMA = "hasna/artifact-manifest/v1";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface ArtifactManifest {
  schema: typeof ARTIFACT_MANIFEST_SCHEMA;
  app: string;
  kind: string;
  owner: string;
  id: string;
  /** Lowercase hex digest of the stored bytes. Absent only for legacy staging uploads completed without a checksum. */
  sha256?: string;
  byteSize: number;
  contentType: string;
  filename: string;
  createdAt: number;
  storageKey: string;
}

/** Lowercase hex sha-256 of some bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Lowercase hex sha-256 of a file's contents. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export function assertSha256Hex(value: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new Error("content digest must be a lowercase hex sha-256; refusing to build a storage key from it");
  }
}

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

/**
 * Content-addressed object key: `attachments/global/<sha256>[<ext>]`.
 * The extension is preserved (lowercased, capped at 24 chars) for operator
 * tooling; it never participates in addressing.
 */
export function canonicalBlobKey(sha256: string, filename: string, extOverride?: string): string {
  assertSha256Hex(sha256);
  const ext = (extOverride ?? extname(filename)).toLowerCase().slice(0, 24);
  return `${ATTACHMENTS_KIND}/${ATTACHMENTS_OWNER}/${sha256}${ext}`;
}

/**
 * Staging key for uploads whose bytes have not been digested yet (presigned
 * PUT / direct multipart). The object lives under
 * `attachments/global/uploads/<id>`; rows keep the key verbatim so reads work
 * unchanged — a staging key is the compatibility path for clients that do not
 * supply a content digest, and it is always resolvable.
 */
export function stagingKey(id: string): string {
  return `${ATTACHMENTS_KIND}/${ATTACHMENTS_OWNER}/${STAGING_NAMESPACE}/${id}`;
}

/** Immutable manifest object key for one attachment row. */
export function manifestKey(id: string): string {
  return `${ATTACHMENTS_KIND}/${ATTACHMENTS_OWNER}/${MANIFEST_NAMESPACE}/${id}.json`;
}

/**
 * Legacy pre-alignment object keys: date/id-partitioned
 * `attachments/YYYY-MM-DD/att_<id>/<random>[.<ext>]`.
 */
export const LEGACY_OBJECT_KEY_PATTERN = /^attachments\/\d{4}-\d{2}-\d{2}\//;

export function isLegacyObjectKey(key: string): boolean {
  return LEGACY_OBJECT_KEY_PATTERN.test(key);
}

/** True for keys inside the staging namespace (pre-digest uploads). */
export function isStagingKey(key: string): boolean {
  return key.startsWith(`${ATTACHMENTS_KIND}/${ATTACHMENTS_OWNER}/${STAGING_NAMESPACE}/`);
}

/** True for keys under the canonical kind/owner layout (blobs or manifests). */
export function isCanonicalKey(key: string): boolean {
  return key.startsWith(`${ATTACHMENTS_KIND}/${ATTACHMENTS_OWNER}/`) && !isStagingKey(key);
}

/** Manifest for one attachment row (see ArtifactManifest). */
export function buildArtifactManifest(input: Omit<ArtifactManifest, "schema" | "kind" | "owner" | "app">): ArtifactManifest {
  return {
    schema: ARTIFACT_MANIFEST_SCHEMA,
    app: "attachments",
    kind: ATTACHMENTS_KIND,
    owner: ATTACHMENTS_OWNER,
    ...input,
  };
}