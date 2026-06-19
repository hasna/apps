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
    limit: z.number().optional().default(50),
    offset: z.number().optional().default(0),
  }, (params) => {
    try {
      return ok(listFileOrganizationReviews(params));
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
    limit: z.number().int().nonnegative().optional().default(1000),
  }, (params) => {
    try {
      const audit = exportFileOrganizationAudit({
        include_events: params.include_events,
        limit: params.limit,
      });
      return { content: [{ type: "text", text: formatFileOrganizationAuditExport(audit, params.format) }] };
    } catch (error) {
      return err(error);
    }
  });

  registerTool("files_organization_events", "List organization audit events for a review or file", {
    id_or_file_id: z.string(),
    limit: z.number().optional().default(50),
  }, ({ id_or_file_id, limit }) => {
    try {
      return ok(listFileOrganizationEvents(id_or_file_id, limit));
    } catch (error) {
      return err(error);
    }
  });
}
