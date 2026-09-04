/**
 * Canonical artifact key layout for the files evidence object store.
 *
 * Adopted from the artifact-remote kit key layout (hasna/apps#1631,
 * implemented first by the skills app in hasna/apps#1639):
 *
 *   evidence/<owner>/<sha256>[.<ext>]             content-addressed object
 *   evidence/<owner>/manifests/<asset_id>.json    immutable per-asset manifest
 *   quarantine/<objectKey>                        staging namespace (new uploads)
 *
 * - kind = `evidence`: a fixed namespace so the evidence bytes live under
 *   one prefix regardless of which bucket env resolved; the layout is
 *   identical in a dedicated evidence bucket or in the shared files bucket
 *   (the `EVIDENCE_S3_BUCKET` / `HASNA_FILES_EVIDENCE_BUCKET` alias), so a
 *   future consolidation is a copy, never a rewrite (hasna/apps#1650).
 * - owner = the sanitized org id: structural, a bucket policy or lifecycle
 *   rule can key on it, and two orgs can never share a key even when a
 *   content digest matches (the digest alone is not enough — evidence is
 *   tenant-scoped).
 * - sha256 = lowercase hex digest of the stored bytes, matching the asset
 *   row's `checksum` (both are mandatory for evidence assets).
 *
 * Properties:
 * - Duplicate uploads of identical bytes for the same org land on the SAME
 *   key. Completion deletes the quarantine object after (or instead of) the
 *   copy when the canonical object already exists with the same checksum, so
 *   a duplicate upload never leaves a second object.
 * - The manifest is written on completion (one per asset id, immutable) and
 *   carries the content address plus provenance, so a bucket listing is
 *   restorable without the database.
 */

import { extname } from "path";
import type { FileAsset } from "../types/index.js";

/** Kind/namespace segment for evidence objects (fixed; never the free-form `kind` field). */
export const EVIDENCE_NAMESPACE = "evidence";
/** Sub-namespace where per-asset manifests live, sibling to the blobs. */
export const MANIFEST_NAMESPACE = "manifests";
/** Lowercase hex sha-256; anything else must never reach a storage key. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Canonical manifest schema identifier (not a URL; no infra identity). */
export const ARTIFACT_MANIFEST_SCHEMA = "hasna/artifact-manifest/v1";

export interface EvidenceManifest {
  schema: typeof ARTIFACT_MANIFEST_SCHEMA;
  app: string;
  kind: string;
  owner: string;
  id: string;
  sha256: string;
  byteSize: number;
  contentType: string;
  filename: string;
  createdAt: string;
  storageKey: string;
  version: number;
  provenance_type: string;
  provenance_id: string;
}

export function assertSha256Hex(value: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new Error("content digest must be a lowercase hex sha-256; refusing to build a storage key from it");
  }
}

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

function cleanSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._=-]+/g, "-").replace(/^-+|-+$/g, "") || "_";
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

/**
 * Content-addressed evidence object key:
 * `<prefix>/evidence/<org_id>/<sha256>[<ext>]`.
 */
export function buildEvidenceObjectKey(input: {
  org_id: string;
  checksum: string;
  original_name: string;
  prefix?: string;
}): string {
  const sha = input.checksum.toLowerCase();
  assertSha256Hex(sha);
  const ext = extname(input.original_name).toLowerCase().slice(0, 24);
  return [
    trimSlashes(input.prefix ?? ""),
    EVIDENCE_NAMESPACE,
    cleanSegment(input.org_id),
    `${sha}${ext}`,
  ].filter(Boolean).join("/");
}

/** Immutable manifest object key for one evidence asset. */
export function buildEvidenceManifestKey(input: {
  org_id: string;
  asset_id: string;
  prefix?: string;
}): string {
  return [
    trimSlashes(input.prefix ?? ""),
    EVIDENCE_NAMESPACE,
    cleanSegment(input.org_id),
    MANIFEST_NAMESPACE,
    `${input.asset_id}.json`,
  ].filter(Boolean).join("/");
}

/**
 * Legacy pre-alignment evidence keys: `orgs/...` (id-partitioned, with date
 * segments) and `tenants/...` id-partitioned keys from the second bucket
 * layout. Rows persist their own `object_key` and every read resolves it
 * verbatim, so legacy objects stay readable for the whole migration window;
 * this classifier makes the layout explicit for tooling and tests.
 */
export function isLegacyEvidenceKey(key: string): boolean {
  const segments = key.split("/");
  // Canonical-layout keys carry an `evidence` or `quarantine` path segment
  // (possibly after an operator-set prefix); anything else is legacy.
  return !segments.includes(EVIDENCE_NAMESPACE) && !segments.includes("quarantine");
}

/** True for keys under the canonical evidence or quarantine namespaces. */
export function isCanonicalEvidenceKey(key: string): boolean {
  return !isLegacyEvidenceKey(key);
}

/** Manifest for one evidence asset (see EvidenceManifest). */
export function buildEvidenceManifest(asset: FileAsset, storageKey: string): EvidenceManifest {
  return {
    schema: ARTIFACT_MANIFEST_SCHEMA,
    app: "files",
    kind: "evidence",
    owner: asset.org_id,
    id: asset.id,
    sha256: asset.checksum.toLowerCase(),
    byteSize: asset.size,
    contentType: asset.content_type,
    filename: asset.original_name,
    createdAt: asset.created_at,
    storageKey,
    version: asset.version,
    provenance_type: asset.provenance_type,
    provenance_id: asset.provenance_id,
  };
}