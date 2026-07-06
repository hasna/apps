import { z } from "zod";
import { appendAudit } from "../db/audit.js";
import { deleteDocument, getDocument, insertDocument, listDocuments } from "../db/crud.js";
import { DOCUMENT_TYPES, NotFoundError, type FilingDocument } from "../types/index.js";
import { authorizeAsset, requireAsset, type ServiceContext } from "./runtime.js";

// Filing document references (via iapp-signatures / iapp-files). We store a doc_ref
// (external id/uri) plus metadata; the binary lives in the referenced system.
const createSchema = z.object({
  asset_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  doc_type: z.enum(DOCUMENT_TYPES).optional(),
  doc_ref: z.string().trim().max(500).optional(),
});
export type CreateDocumentInput = z.infer<typeof createSchema>;

export function createDocument(ctx: ServiceContext, input: CreateDocumentInput): FilingDocument {
  const parsed = createSchema.parse(input);
  const asset = requireAsset(ctx, parsed.asset_id);
  authorizeAsset(ctx, "write", asset, "document");
  const row = insertDocument(ctx.db, {
    asset_id: parsed.asset_id,
    title: parsed.title,
    ...(parsed.doc_type !== undefined ? { doc_type: parsed.doc_type } : {}),
    doc_ref: parsed.doc_ref ?? null,
  });
  appendAudit(ctx.db, {
    action: "document.create",
    resource: "document",
    resource_id: row.id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: { title: row.title, doc_type: row.doc_type },
  });
  return row;
}

export function getDocumentById(ctx: ServiceContext, id: string): FilingDocument {
  const row = getDocument(ctx.db, id);
  if (!row) throw new NotFoundError("document", id);
  const asset = requireAsset(ctx, row.asset_id);
  authorizeAsset(ctx, "read", asset, "document");
  return row;
}

export function listDocumentsService(ctx: ServiceContext, input: { asset_id?: string } = {}): FilingDocument[] {
  const rows = listDocuments(ctx.db, input);
  if (ctx.auth.bypass) return rows;
  return rows.filter((row) => {
    const asset = requireAsset(ctx, row.asset_id);
    try {
      authorizeAsset(ctx, "read", asset, "document");
      return true;
    } catch {
      return false;
    }
  });
}

export function deleteDocumentService(ctx: ServiceContext, id: string): { id: string; deleted: boolean } {
  const row = getDocument(ctx.db, id);
  if (!row) throw new NotFoundError("document", id);
  const asset = requireAsset(ctx, row.asset_id);
  authorizeAsset(ctx, "write", asset, "document");
  const deleted = deleteDocument(ctx.db, id);
  appendAudit(ctx.db, {
    action: "document.delete",
    resource: "document",
    resource_id: id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: {},
  });
  return { id, deleted };
}
