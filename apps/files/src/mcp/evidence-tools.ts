import { z } from "zod";
import { store } from "../store/index.js";
import {
  sanitizeEvidenceTransportError,
  toEvidenceUploadReceipt,
  type EvidenceStorageOptions,
} from "../lib/evidence.js";
import type { FileAssetStatus, FileStorageProvider } from "../types/index.js";

type ToolHandler = (params: any) => unknown | Promise<unknown>;
type RegisterTool = (
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  handler: ToolHandler,
) => void;

const storageSchema = {
  storage: z.enum(["s3", "local"]).optional().describe("Evidence storage provider"),
  bucket: z.string().optional().describe("S3 bucket; defaults to hasna-xyz-opensource-files-prod"),
  region: z.string().optional().describe("S3 region"),
  aws_profile: z.string().optional().describe("AWS named profile"),
  prefix: z.string().optional().describe("Object key prefix"),
  local_root: z.string().optional().describe("Local evidence root for local mode"),
};

const assetStatusSchema = z.enum(["pending_upload", "uploaded", "verified", "archived", "deleted"]);

export function registerEvidenceTools(registerTool: RegisterTool): void {
  registerTool("create_evidence_upload_intent", "Create a shared evidence asset and safe opaque upload handle", {
    org_id: z.string(),
    company_id: z.string().optional(),
    app: z.string().describe("Owning app, e.g. iapp-accounting"),
    kind: z.string().describe("Evidence kind, e.g. receipt"),
    original_name: z.string(),
    content_type: z.string().optional(),
    size: z.number().int().nonnegative(),
    checksum: z.string().describe("sha256 hex digest"),
    classification: z.string().optional(),
    retention_until: z.string().optional(),
    retention_policy: z.string().optional(),
    storage_class: z.string().optional(),
    legal_hold: z.boolean().optional(),
    immutable: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
    expires_in_seconds: z.number().int().positive().optional(),
    ...storageSchema,
  }, async (params) => safeEvidenceTool(async () => {
    const result = await store().createEvidenceUploadIntent({
      org_id: params.org_id,
      company_id: params.company_id,
      app: params.app,
      kind: params.kind,
      original_name: params.original_name,
      content_type: params.content_type,
      size: params.size,
      checksum: params.checksum,
      classification: params.classification,
      retention_until: params.retention_until,
      retention_policy: params.retention_policy,
      storage_class: params.storage_class,
      legal_hold: params.legal_hold,
      immutable: params.immutable,
      metadata: params.metadata,
      expires_in_seconds: params.expires_in_seconds,
    }, storageOptions(params));
    return jsonResult(toEvidenceUploadReceipt(result));
  }));

  registerTool("upload_evidence_file", "Upload a local file into the shared evidence vault and complete verification", {
    path: z.string(),
    org_id: z.string(),
    company_id: z.string().optional(),
    app: z.string(),
    kind: z.string(),
    original_name: z.string().optional(),
    classification: z.string().optional(),
    retention_until: z.string().optional(),
    retention_policy: z.string().optional(),
    storage_class: z.string().optional(),
    legal_hold: z.boolean().optional(),
    immutable: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
    ...storageSchema,
  }, async (params) => safeEvidenceTool(async () => {
    const result = await store().uploadEvidenceFile({
      path: params.path,
      org_id: params.org_id,
      company_id: params.company_id,
      app: params.app,
      kind: params.kind,
      original_name: params.original_name,
      classification: params.classification,
      retention_until: params.retention_until,
      retention_policy: params.retention_policy,
      storage_class: params.storage_class,
      legal_hold: params.legal_hold,
      immutable: params.immutable,
      metadata: params.metadata,
    }, storageOptions(params));
    return jsonResult(toEvidenceUploadReceipt(result));
  }));

  registerTool("complete_evidence_upload", "Complete an evidence upload intent after bytes are uploaded", {
    intent_id: z.string(),
    ...storageSchema,
  }, async (params) => safeEvidenceTool(async () =>
    jsonResult(await store().completeEvidenceUpload(params.intent_id, storageOptions(params)))));

  registerTool("link_evidence_asset", "Link a verified evidence asset to an app domain record", {
    asset_id: z.string(),
    org_id: z.string(),
    company_id: z.string().optional(),
    app: z.string(),
    source_type: z.string(),
    source_id: z.string(),
    kind: z.string(),
    metadata: z.record(z.unknown()).optional(),
  }, async (params) => jsonResult(await store().linkEvidenceAsset({
    asset_id: params.asset_id,
    org_id: params.org_id,
    company_id: params.company_id,
    app: params.app,
    source_type: params.source_type,
    source_id: params.source_id,
    kind: params.kind,
    metadata: params.metadata,
  })));

  registerTool("sign_evidence_download", "Create a short-lived evidence download URL/path and record access", {
    asset_id: z.string(),
    actor_id: z.string().optional(),
    purpose: z.string().optional(),
    expires_in_seconds: z.number().int().positive().optional(),
    ...storageSchema,
  }, async (params) => jsonResult(await store().signEvidenceDownload({
    asset_id: params.asset_id,
    actor_id: params.actor_id,
    purpose: params.purpose,
    expires_in_seconds: params.expires_in_seconds,
  }, storageOptions(params))));

  registerTool("verify_evidence_asset", "Verify evidence object size and checksum", {
    asset_id: z.string(),
    ...storageSchema,
  }, async (params) => jsonResult(await store().verifyEvidenceAsset(params.asset_id, storageOptions(params))));

  registerTool("list_evidence_assets", "List shared evidence assets with app/company filters", {
    org_id: z.string().optional(),
    company_id: z.string().optional(),
    app: z.string().optional(),
    kind: z.string().optional(),
    status: assetStatusSchema.optional(),
    checksum: z.string().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
  }, async (params) => jsonResult(await store().listEvidenceAssets({
    org_id: params.org_id,
    company_id: params.company_id,
    app: params.app,
    kind: params.kind,
    status: params.status as FileAssetStatus | undefined,
    checksum: params.checksum,
    limit: params.limit,
    offset: params.offset,
  })));

  registerTool("audit_evidence_asset", "Return evidence asset links and access audit events", {
    asset_id: z.string(),
    limit: z.number().int().positive().optional(),
  }, async (params) => jsonResult({
    links: await store().listEvidenceLinks(params.asset_id),
    events: await store().listEvidenceAccessEvents(params.asset_id, params.limit ?? 50),
  }));
}

function storageOptions(params: {
  storage?: FileStorageProvider;
  bucket?: string;
  region?: string;
  aws_profile?: string;
  prefix?: string;
  local_root?: string;
}): EvidenceStorageOptions {
  return {
    provider: params.storage,
    bucket: params.bucket,
    region: params.region,
    profile: params.aws_profile,
    prefix: params.prefix,
    localRoot: params.local_root,
  };
}

function jsonResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function safeEvidenceTool<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw sanitizeEvidenceTransportError(error);
  }
}
