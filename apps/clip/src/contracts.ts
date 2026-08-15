import {
  parseContract,
  SCHEMA_IDS,
  type EvidenceRef,
  type EvidenceRefInput,
  type ResourcePointer,
  type ResourceRef,
  type ResourceRefInput,
} from "@hasna/contracts";
import type { ClipKind, ClipRecord } from "./types.js";

export type ClipContractFormat = "evidence" | "resources" | "all";

export interface ClipRecordContracts {
  evidenceRef: EvidenceRef;
  resourceRefs: ResourceRef[];
}

const SOURCE_PACKAGE = "@hasna/clip";

function clipTags(record: ClipRecord, extra: string[] = []): string[] {
  return ["clip", record.kind, ...extra];
}

function titleFor(record: ClipRecord): string {
  return record.title?.trim() || `${record.kind} clip ${record.slug}`;
}

function artifactUri(record: ClipRecord): string {
  return `artifact://@hasna/clip/clips/${encodeURIComponent(record.id)}`;
}

function evidenceKindFor(kind: ClipKind): EvidenceRefInput["kind"] {
  if (kind === "screenshot") return "screenshot";
  if (kind === "text" || kind === "clipboard-text") return "url";
  if (kind === "file" || kind === "clipboard-file" || kind === "clipboard-image") return "file";
  return "artifact";
}

function toResourcePointer(ref: ResourceRef): ResourcePointer {
  return {
    kind: ref.kind,
    id: ref.id,
    name: ref.name,
    uri: ref.uri,
    externalId: ref.externalId,
    sourcePackage: ref.sourcePackage,
    tags: ref.tags,
  };
}

export function buildClipResourceRefs(record: ClipRecord): ResourceRef[] {
  const createdAt = record.createdAt;
  const refs: ResourceRef[] = [];

  if (record.artifactPath) {
    const draft: ResourceRefInput = {
      schema: SCHEMA_IDS.resourceRef,
      id: `clip_artifact_${record.id}`,
      createdAt,
      updatedAt: record.updatedAt,
      kind: "artifact",
      name: `${titleFor(record)} artifact`,
      uri: artifactUri(record),
      externalId: record.id,
      sourcePackage: SOURCE_PACKAGE,
      tags: clipTags(record, ["artifact"]),
    };
    refs.push(parseContract(SCHEMA_IDS.resourceRef, draft));
  }

  if (record.shareUrl) {
    const draft: ResourceRefInput = {
      schema: SCHEMA_IDS.resourceRef,
      id: `clip_share_url_${record.id}`,
      createdAt,
      updatedAt: record.updatedAt,
      kind: "url",
      name: `${titleFor(record)} share URL`,
      uri: record.shareUrl,
      externalId: record.slug,
      sourcePackage: SOURCE_PACKAGE,
      tags: clipTags(record, ["share-url"]),
    };
    refs.push(parseContract(SCHEMA_IDS.resourceRef, draft));
  }

  return refs;
}

export function buildClipEvidenceRef(record: ClipRecord): EvidenceRef {
  const resources = buildClipResourceRefs(record);
  const primaryResource = resources[0];
  const uri = primaryResource?.uri ?? record.shareUrl ?? artifactUri(record);
  const draft: EvidenceRefInput = {
    schema: SCHEMA_IDS.evidenceRef,
    id: `clip_evidence_${record.id}`,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    kind: evidenceKindFor(record.kind),
    uri,
    sha256: record.sha256,
    summary: titleFor(record),
    contentType: record.mimeType,
    sizeBytes: record.sizeBytes,
    redaction: "unknown",
    resourceRefs: resources.map(toResourcePointer),
    tags: clipTags(record, ["evidence"]),
    metadata: {
      slug: record.slug,
      source: record.source,
      clipKind: record.kind,
      hasLocalArtifact: Boolean(record.artifactPath),
      hasShareUrl: Boolean(record.shareUrl),
    },
  };
  return parseContract(SCHEMA_IDS.evidenceRef, draft);
}

export function buildClipRecordContracts(record: ClipRecord): ClipRecordContracts {
  return {
    evidenceRef: buildClipEvidenceRef(record),
    resourceRefs: buildClipResourceRefs(record),
  };
}
