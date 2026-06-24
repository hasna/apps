import { z } from "zod";
import {
  bootstrapGoogleDriveOrganizationQueues,
  exportFileOrganizationAudit,
  formatFileOrganizationAuditExport,
  getFileOrganizationStats,
  listFileOrganizationEvents,
  listFileOrganizationReviews,
  updateFileOrganizationReview,
} from "../db/organization.js";
import {
  DEFAULT_MCP_LIMIT,
  compactPage,
  normalizeCompactLimit,
  truncateText,
} from "../lib/compact-output.js";
import type {
  FileOrganizationAuditExport,
  FileOrganizationAuditExportEvent,
  FileOrganizationAuditExportRow,
  FileOrganizationEvent,
  FileOrganizationReviewWithFile,
} from "../types/index.js";

type ToolHandler = (params: any) => unknown | Promise<unknown>;
type RegisterTool = (
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  handler: ToolHandler,
) => void;

function ok(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

const reviewStatus = z.enum(["unreviewed", "in_review", "approved", "moved", "duplicate", "ignored"]);
const rootType = z.enum(["my_drive", "shared_drive", "unknown"]);
const aclReviewStatus = z.enum(["needs_review", "approved", "restricted", "external_review", "unknown"]);
const permissionScope = z.enum(["unknown", "private", "domain", "shared_drive", "external", "public", "mixed"]);
const permissionRisk = z.enum(["unknown", "low", "medium", "high"]);
const exportFormat = z.enum(["json", "jsonl", "csv"]);

export function registerOrganizationTools(registerTool: RegisterTool): void {
  registerTool("files_organization_bootstrap_google_drive", "Create or refresh Google Drive archive review queues", {}, () => {
    try {
      return ok(bootstrapGoogleDriveOrganizationQueues());
    } catch (error) {
      return err(error);
    }
  });

  registerTool("files_organization_stats", "Show file organization review progress", {}, () => {
    try {
      return ok(getFileOrganizationStats());
    } catch (error) {
      return err(error);
    }
  });

  registerTool("files_organization_reviews", "List file organization review rows", {
    status: reviewStatus.optional(),
    root_type: rootType.optional(),
    owner: z.string().optional(),
    acl_review_status: aclReviewStatus.optional(),
    permission_risk: permissionRisk.optional(),
    duplicate_only: z.boolean().optional(),
    limit: z.number().int().positive().optional().default(DEFAULT_MCP_LIMIT),
    offset: z.number().optional().default(0),
    verbose: z.boolean().optional().default(false).describe("Return full review rows instead of compact summaries"),
  }, (params) => {
    try {
      const limit = normalizeCompactLimit(params.limit);
      const offset = normalizeOffset(params.offset);
      const rows = listFileOrganizationReviews({ ...params, limit, offset });
      if (params.verbose) return ok(rows);
      return ok(compactPage(rows.map(compactOrganizationReview), {
        limit,
        offset,
        hasMore: rows.length === limit,
        hint: "Use verbose=true for full paths and review metadata, or files_organization_update_review for one row.",
      }));
    } catch (error) {
      return err(error);
    }
  });

  registerTool("files_organization_update_review", "Update a file organization review row and write an audit event", {
    id_or_file_id: z.string(),
    status: reviewStatus.optional(),
    owner: z.string().nullable().optional(),
    acl_review_status: aclReviewStatus.optional(),
    permission_scope: permissionScope.optional(),
    permission_risk: permissionRisk.optional(),
    permission_notes: z.string().nullable().optional(),
    permissions_metadata: z.record(z.unknown()).optional(),
    labels: z.array(z.string()).optional(),
    target_path: z.string().nullable().optional(),
    target_collection_id: z.string().nullable().optional(),
    target_project_id: z.string().nullable().optional(),
    duplicate_group_id: z.string().nullable().optional(),
    reviewer: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    actor: z.string().optional(),
    note: z.string().optional(),
  }, (params) => {
    try {
      return ok(updateFileOrganizationReview(params.id_or_file_id, params));
    } catch (error) {
      return err(error);
    }
  });

  registerTool("files_organization_export_audit", "Export organization progress and audit evidence", {
    format: exportFormat.optional().default("json"),
    include_events: z.boolean().optional(),
    limit: z.number().int().positive().optional().default(DEFAULT_MCP_LIMIT),
    verbose: z.boolean().optional().default(false).describe("Return the full formatted export instead of a compact summary"),
  }, (params) => {
    try {
      const limit = normalizeCompactLimit(params.limit);
      const audit = exportFileOrganizationAudit({
        include_events: params.include_events,
        limit,
      });
      if (params.verbose) {
        return { content: [{ type: "text", text: formatFileOrganizationAuditExport(audit, params.format) }] };
      }
      return ok(compactOrganizationAudit(audit, params.format, limit));
    } catch (error) {
      return err(error);
    }
  });

  registerTool("files_organization_events", "List organization audit events for a review or file", {
    id_or_file_id: z.string(),
    limit: z.number().int().positive().optional().default(DEFAULT_MCP_LIMIT),
    verbose: z.boolean().optional().default(false).describe("Return full audit event records instead of compact summaries"),
  }, ({ id_or_file_id, limit, verbose }) => {
    try {
      const normalizedLimit = normalizeCompactLimit(limit);
      const events = listFileOrganizationEvents(id_or_file_id, normalizedLimit);
      if (verbose) return ok(events);
      return ok(compactPage(events.map(compactOrganizationEvent), {
        limit: normalizedLimit,
        offset: 0,
        hasMore: events.length === normalizedLimit,
        hint: "Use verbose=true for full before/after state and notes.",
      }));
    } catch (error) {
      return err(error);
    }
  });
}

function normalizeOffset(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

function compactOrganizationReview(row: FileOrganizationReviewWithFile): Record<string, unknown> {
  return definedRecord({
    id: row.id,
    file_id: row.file_id,
    file_name: truncateText(row.file_name, 64),
    original_path: truncateText(row.original_path, 96),
    root_type: row.root_type,
    owner: row.owner,
    review_status: row.review_status,
    acl_review_status: row.acl_review_status,
    permission_risk: row.permission_risk,
    duplicate_group_id: row.duplicate_group_id,
    updated_at: row.updated_at,
  });
}

function compactOrganizationEvent(event: FileOrganizationEvent): Record<string, unknown> {
  return definedRecord({
    id: event.id,
    review_id: event.review_id,
    file_id: event.file_id,
    action: event.action,
    actor: event.actor,
    from_status: event.from_status,
    to_status: event.to_status,
    note: event.note ? truncateText(event.note, 80) : undefined,
    created_at: event.created_at,
  });
}

function compactOrganizationAudit(
  audit: FileOrganizationAuditExport,
  format: string,
  limit: number,
): Record<string, unknown> {
  return {
    generated_at: audit.generated_at,
    format,
    limit,
    stats: audit.stats,
    summary: audit.summary,
    sample_rows: {
      unresolved: compactAuditRows(audit.unresolved_rows),
      moved: compactAuditRows(audit.moved_rows),
      ignored: compactAuditRows(audit.ignored_rows),
      permission_risk: compactAuditRows(audit.permission_risk_rows),
    },
    events: audit.events ? compactAuditEvents(audit.events) : undefined,
    hint: "Default output is a compact summary. Use verbose=true for the full formatted export and set limit deliberately.",
  };
}

function compactAuditRows(rows: FileOrganizationAuditExportRow[]): Record<string, unknown>[] {
  return rows.slice(0, 5).map((row) => definedRecord({
    review_id: row.review_id,
    file_id: row.file_id,
    file_name: truncateText(row.file_name, 64),
    original_path: truncateText(row.original_path, 96),
    target_path: row.target_path ? truncateText(row.target_path, 96) : undefined,
    owner: row.owner,
    review_status: row.review_status,
    acl_review_status: row.acl_review_status,
    permission_risk: row.permission_risk,
    updated_at: row.updated_at,
  }));
}

function compactAuditEvents(events: FileOrganizationAuditExportEvent[]): Record<string, unknown>[] {
  return events.slice(0, 5).map((event) => definedRecord({
    id: event.id,
    review_id: event.review_id,
    file_id: event.file_id,
    action: event.action,
    actor: event.actor,
    note: event.note ? truncateText(event.note, 80) : undefined,
    created_at: event.created_at,
  }));
}

function definedRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
