import type { Command } from "commander";
import chalk from "chalk";
import { writeFileSync } from "fs";
import {
  applyGoogleDriveUnifiedOrganizationPolicy,
  buildFileOrganizationApprovalPacket,
  bootstrapGoogleDriveOrganizationQueues,
  exportFileOrganizationAudit,
  formatFileOrganizationAuditExport,
  getFileOrganizationStats,
  inferGoogleDriveOrganizationCandidates,
  listFileOrganizationDuplicateGroups,
  listFileOrganizationEvents,
  listFileOrganizationReviews,
  listFileOrganizationUnassignedGroups,
  updateFileOrganizationReview,
} from "../db/organization.js";
import type {
  FileOrganizationAclReviewStatus,
  FileOrganizationPermissionRisk,
  FileOrganizationPermissionScope,
  FileOrganizationAuditExportFormat,
  FileOrganizationReviewStatus,
  FileOrganizationRootType,
} from "../types/index.js";
import { store } from "../store/index.js";

/**
 * Recorded strong reason for the local-transport guard (local-only-capability-
 * removal workflow, 2026-08-18; reviewer-ruled — do not remove this gate by
 * assumption). Organization reviews operate on locally-imported Google Drive
 * metadata (`google_drive_imported_objects`), which the hosted server has no
 * schema, routes, or producer for (see src/mcp/organization-tools.ts for the
 * full evidence chain and its behavior lock). In api mode this refuses instead
 * of silently touching the local SQLite island (the split-brain guard).
 */
function requireLocalOrganize(command: string): void {
  if (store().transport !== "local") {
    console.error(chalk.red(`${command} runs on-box only and is unavailable in cloud (api) mode; organization reviews operate on locally-imported Google Drive metadata.`));
    process.exit(1);
  }
}

interface OrganizationListOptions {
  status?: FileOrganizationReviewStatus;
  rootType?: FileOrganizationRootType;
  owner?: string;
  aclStatus?: FileOrganizationAclReviewStatus;
  permissionRisk?: FileOrganizationPermissionRisk;
  duplicates?: boolean;
  limit: string;
  offset: string;
  json?: boolean;
}

interface OrganizationReviewOptions {
  status?: FileOrganizationReviewStatus;
  owner?: string;
  aclStatus?: FileOrganizationAclReviewStatus;
  permissionScope?: FileOrganizationPermissionScope;
  permissionRisk?: FileOrganizationPermissionRisk;
  permissionNotes?: string;
  reviewer?: string;
  targetPath?: string;
  targetCollection?: string;
  targetProject?: string;
  duplicateGroup?: string;
  label: string[];
  notes?: string;
  actor?: string;
  note?: string;
  json?: boolean;
}

interface OrganizationExportOptions {
  format: FileOrganizationAuditExportFormat;
  output?: string;
  includeEvents?: boolean;
  limit: string;
}

interface OrganizationInferOptions {
  rootType?: FileOrganizationRootType;
  apply?: boolean;
  actor?: string;
  limit: string;
  json?: boolean;
}

interface OrganizationApplyDrivePolicyOptions {
  apply?: boolean;
  markMoved?: boolean;
  actor?: string;
  limit: string;
  json?: boolean;
}

interface OrganizationDuplicateOptions {
  owner?: string;
  unassigned?: boolean;
  rootType?: FileOrganizationRootType;
  includeRows?: boolean;
  limit: string;
  offset: string;
  json?: boolean;
}

interface OrganizationUnassignedOptions {
  rootType?: FileOrganizationRootType;
  topLevel?: string;
  excludeTopLevel: string[];
  includeRows?: boolean;
  limit: string;
  offset: string;
  json?: boolean;
}

interface OrganizationApprovalPacketOptions {
  rootType?: FileOrganizationRootType;
  owner?: string;
  aclStatus?: FileOrganizationAclReviewStatus;
  sampleLimit: string;
  duplicateLimit: string;
  output?: string;
  json?: boolean;
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function parseLimit(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

export function registerOrganizationCommands(program: Command): void {
  const organize = program
    .command("organize")
    .description("Review and organize imported file archives");

  organize
    .command("bootstrap-google-drive")
    .description("Create or refresh Google Drive archive review queues from imported Drive metadata")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      requireLocalOrganize("files organize bootstrap-google-drive");
      const result = bootstrapGoogleDriveOrganizationQueues();
      if (opts.json) {
        printJson(result);
        return;
      }

      console.log(chalk.green(`Created ${result.created} review row(s), updated ${result.updated}`));
      console.log(chalk.dim(`Scanned ${result.scanned} Drive row(s); duplicate rows: ${result.duplicate_rows}; collections created: ${result.collections_created}`));
    });

  organize
    .command("stats")
    .description("Show file organization review progress")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      requireLocalOrganize("files organize stats");
      const stats = getFileOrganizationStats();
      if (opts.json) {
        printJson(stats);
        return;
      }

      console.log(chalk.bold("Organization Reviews"));
      console.log(`  total: ${stats.total}`);
      console.log(`  duplicate rows: ${stats.duplicate_rows}`);
      console.log(`  unassigned owner: ${stats.unassigned_owner}`);
      console.log(`  missing target: ${stats.missing_target}`);
      console.log(`  ACL needs review: ${stats.acl_needs_review}`);
      console.log(`  high-risk permissions: ${stats.high_risk_permissions}`);
      for (const row of stats.by_status) console.log(`  ${row.review_status}: ${row.count}`);
      for (const row of stats.by_acl_status) console.log(`  acl:${row.acl_review_status}: ${row.count}`);
    });

  organize
    .command("list")
    .description("List file organization review rows")
    .option("--status <status>", "Filter by review status")
    .option("--root-type <type>", "Filter by root type: my_drive, shared_drive, unknown")
    .option("--owner <owner>", "Filter by owner")
    .option("--acl-status <status>", "Filter by ACL review status")
    .option("--permission-risk <risk>", "Filter by permission risk")
    .option("--duplicates", "Only duplicate rows")
    .option("-l, --limit <n>", "Max rows", "50")
    .option("--offset <n>", "Offset", "0")
    .option("--json", "Output as JSON")
    .action((opts: OrganizationListOptions) => {
      requireLocalOrganize("files organize list");
      try {
        const rows = listFileOrganizationReviews({
          status: opts.status,
          root_type: opts.rootType,
          owner: opts.owner,
          acl_review_status: opts.aclStatus,
          permission_risk: opts.permissionRisk,
          duplicate_only: opts.duplicates,
          limit: parseLimit(opts.limit, "limit"),
          offset: parseLimit(opts.offset, "offset"),
        });
        if (opts.json) {
          printJson(rows);
          return;
        }
        for (const row of rows) {
          const duplicate = row.duplicate_group_id ? chalk.yellow(" duplicate") : "";
          const owner = row.owner ? chalk.dim(` owner:${row.owner}`) : "";
          const acl = chalk.dim(` acl:${row.acl_review_status}/${row.permission_risk}`);
          console.log(`${chalk.bold(row.id)}  ${chalk.cyan(row.review_status)}${duplicate}${owner}${acl}  ${row.file_name}  ${chalk.dim(row.original_path)}`);
        }
        console.log(chalk.dim(`\n${rows.length} review row(s)`));
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  organize
    .command("review <id-or-file-id>")
    .description("Update a file organization review row")
    .option("--status <status>", "New status: unreviewed, in_review, approved, moved, duplicate, ignored")
    .option("--owner <owner>", "Owner/profile/team responsible for the file")
    .option("--acl-status <status>", "ACL status: needs_review, approved, restricted, external_review, unknown")
    .option("--permission-scope <scope>", "Permission scope: unknown, private, domain, shared_drive, external, public, mixed")
    .option("--permission-risk <risk>", "Permission risk: unknown, low, medium, high")
    .option("--permission-notes <text>", "Persistent ACL/permission review notes")
    .option("--reviewer <reviewer>", "Reviewer name or agent")
    .option("--target-path <path>", "Logical destination path/folder for the file")
    .option("--target-collection <id>", "Collection to attach as the destination")
    .option("--target-project <id>", "Project to attach as the destination")
    .option("--duplicate-group <id>", "Duplicate group id")
    .option("--label <label>", "Label to set on the review row", collectValues, [] as string[])
    .option("--notes <text>", "Persistent review notes")
    .option("--actor <actor>", "Actor for the audit log")
    .option("--note <text>", "Audit-log note for this change")
    .option("--json", "Output as JSON")
    .action((idOrFileId: string, opts: OrganizationReviewOptions) => {
      requireLocalOrganize("files organize review");
      try {
        const review = updateFileOrganizationReview(idOrFileId, {
          status: opts.status,
          owner: opts.owner,
          acl_review_status: opts.aclStatus,
          permission_scope: opts.permissionScope,
          permission_risk: opts.permissionRisk,
          permission_notes: opts.permissionNotes,
          reviewer: opts.reviewer,
          target_path: opts.targetPath,
          target_collection_id: opts.targetCollection,
          target_project_id: opts.targetProject,
          duplicate_group_id: opts.duplicateGroup,
          labels: opts.label.length > 0 ? opts.label : undefined,
          notes: opts.notes,
          actor: opts.actor,
          note: opts.note,
        });
        if (opts.json) {
          printJson(review);
          return;
        }
        console.log(chalk.green(`Updated ${review.id}: ${review.review_status}`));
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  organize
    .command("infer-google-drive")
    .description("Infer candidate owners and target paths from Google Drive folder structure")
    .option("--root-type <type>", "Filter by root type: shared_drive, my_drive, unknown", "shared_drive")
    .option("--apply", "Persist inferred candidates as in_review metadata updates")
    .option("--actor <actor>", "Actor for audit events", "open-files-organize-infer")
    .option("-l, --limit <n>", "Max rows to scan; 0 scans all", "0")
    .option("--json", "Output as JSON")
    .action((opts: OrganizationInferOptions) => {
      requireLocalOrganize("files organize infer-google-drive");
      try {
        const result = inferGoogleDriveOrganizationCandidates({
          root_type: opts.rootType,
          apply: opts.apply,
          actor: opts.actor,
          limit: parseLimit(opts.limit, "limit"),
        });
        if (opts.json) {
          printJson(result);
          return;
        }
        console.log(chalk.bold("Google Drive Organization Inference"));
        console.log(`  mode: ${result.dry_run ? "dry run" : "applied"}`);
        console.log(`  scanned: ${result.scanned}`);
        console.log(`  matched: ${result.matched}`);
        console.log(`  updated: ${result.updated}`);
        console.log(`  skipped: ${result.skipped}`);
        for (const row of result.by_owner) console.log(`  owner:${row.owner}: ${row.count}`);
        if (result.dry_run) console.log(chalk.dim("Use --apply to stage candidates. ACL status remains needs_review."));
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  organize
    .command("apply-drive-policy")
    .description("Apply the unified Google Drive organization policy as metadata-only review updates")
    .option("--apply", "Persist metadata updates; default is dry-run")
    .option("--mark-moved", "Mark surviving non-duplicate rows moved instead of approved")
    .option("--actor <actor>", "Actor for audit events", "open-files-unified-drive-policy")
    .option("-l, --limit <n>", "Max rows to scan; 0 scans all", "0")
    .option("--json", "Output as JSON")
    .action((opts: OrganizationApplyDrivePolicyOptions) => {
      requireLocalOrganize("files organize apply-drive-policy");
      try {
        const result = applyGoogleDriveUnifiedOrganizationPolicy({
          apply: opts.apply,
          mark_moved: opts.markMoved,
          actor: opts.actor,
          limit: parseLimit(opts.limit, "limit"),
        });
        if (opts.json) {
          printJson(result);
          return;
        }
        console.log(chalk.bold("Unified Google Drive Policy"));
        console.log(`  mode: ${result.dry_run ? "dry run" : "applied"}`);
        console.log(`  scanned: ${result.scanned}`);
        console.log(`  planned updates: ${result.planned_updates}`);
        console.log(`  metadata moves: ${result.metadata_moves}`);
        console.log(`  duplicate groups: ${result.duplicate_groups}`);
        console.log(`  duplicate rows: ${result.duplicate_rows}`);
        console.log(`  permission approvals: ${result.permission_approvals}`);
        console.log(`  target collisions disambiguated: ${result.target_collisions}`);
        console.log(`  skipped: ${result.skipped}`);
        for (const row of result.by_owner) console.log(`  owner:${row.owner}: ${row.count}`);
        if (result.dry_run) {
          console.log(chalk.dim("Use --apply to write review metadata. This command does not rewrite S3 objects or retire legacy backups."));
        }
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  organize
    .command("duplicates")
    .description("Summarize duplicate content groups and candidate survivor rows")
    .option("--owner <owner>", "Filter by owner candidate")
    .option("--unassigned", "Filter to groups containing rows with no owner candidate")
    .option("--root-type <type>", "Filter by root type: my_drive, shared_drive, unknown")
    .option("--include-rows", "Include row-level details in JSON output")
    .option("-l, --limit <n>", "Max groups", "50")
    .option("--offset <n>", "Offset", "0")
    .option("--json", "Output as JSON")
    .action((opts: OrganizationDuplicateOptions) => {
      requireLocalOrganize("files organize duplicates");
      try {
        if (opts.owner && opts.unassigned) {
          throw new Error("Use either --owner or --unassigned, not both");
        }
        const groups = listFileOrganizationDuplicateGroups({
          owner: opts.owner,
          unassigned: opts.unassigned,
          root_type: opts.rootType,
          include_rows: opts.includeRows,
          limit: parseLimit(opts.limit, "limit"),
          offset: parseLimit(opts.offset, "offset"),
        });
        if (opts.json) {
          printJson(groups);
          return;
        }
        for (const group of groups) {
          const owners = group.owners.join(",");
          const roots = group.root_types.join(",");
          const reasons = group.review_reasons.length > 0 ? group.review_reasons.join(",") : "ready_for_owner_review";
          console.log(`${chalk.bold(group.duplicate_group_id)}  rows:${group.row_count}  roots:${roots}  owners:${owners}`);
          console.log(`  candidate: ${group.candidate_survivor_review_id}  reasons:${chalk.dim(reasons)}`);
        }
        console.log(chalk.dim(`\n${groups.length} duplicate group(s)`));
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  organize
    .command("unassigned")
    .description("Summarize rows still missing owner or target placement")
    .option("--root-type <type>", "Filter by root type: my_drive, shared_drive, unknown")
    .option("--top-level <name>", "Filter by exact top-level folder or root file name")
    .option("--exclude-top-level <name>", "Exclude exact top-level folder or root file name; repeatable", collectValues, [])
    .option("--include-rows", "Include row-level details in JSON output")
    .option("-l, --limit <n>", "Max groups", "50")
    .option("--offset <n>", "Offset", "0")
    .option("--json", "Output as JSON")
    .action((opts: OrganizationUnassignedOptions) => {
      requireLocalOrganize("files organize unassigned");
      try {
        if (opts.topLevel && opts.excludeTopLevel.length > 0) {
          throw new Error("Use either --top-level or --exclude-top-level, not both");
        }
        const groups = listFileOrganizationUnassignedGroups({
          root_type: opts.rootType,
          top_level: opts.topLevel,
          exclude_top_levels: opts.excludeTopLevel,
          include_rows: opts.includeRows,
          limit: parseLimit(opts.limit, "limit"),
          offset: parseLimit(opts.offset, "offset"),
        });
        if (opts.json) {
          printJson(groups);
          return;
        }
        for (const group of groups) {
          const reasons = group.review_reasons.join(",");
          console.log(`${chalk.bold(group.top_level)}  rows:${group.row_count}  root:${group.root_type}  track:${group.suggested_review_track}`);
          console.log(`  duplicates:${group.duplicate_row_count}  root-files:${group.root_file_count}  reasons:${chalk.dim(reasons)}`);
        }
        console.log(chalk.dim(`\n${groups.length} unassigned group(s)`));
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  organize
    .command("approval-packet")
    .description("Build a read-only owner ACL approval packet")
    .option("--root-type <type>", "Filter by root type: my_drive, shared_drive, unknown")
    .option("--owner <owner>", "Filter by owner candidate")
    .option("--acl-status <status>", "Filter by ACL review status", "needs_review")
    .option("--sample-limit <n>", "Max sample rows to include", "25")
    .option("--duplicate-limit <n>", "Max duplicate groups to include", "10")
    .option("--output <path>", "Write JSON packet to a file")
    .option("--json", "Output as JSON")
    .action((opts: OrganizationApprovalPacketOptions) => {
      requireLocalOrganize("files organize approval-packet");
      try {
        const packet = buildFileOrganizationApprovalPacket({
          root_type: opts.rootType,
          owner: opts.owner,
          acl_review_status: opts.aclStatus,
          sample_limit: parseLimit(opts.sampleLimit, "sample-limit"),
          duplicate_limit: parseLimit(opts.duplicateLimit, "duplicate-limit"),
        });
        const json = `${JSON.stringify(packet, null, 2)}\n`;
        if (opts.output) {
          writeFileSync(opts.output, json);
          if (!opts.json) {
            console.log(chalk.green(`Wrote owner ACL approval packet: ${opts.output}`));
            console.log(chalk.dim(`rows:${packet.summary.row_count} duplicates:${packet.summary.duplicate_row_count} samples:${packet.samples.length}`));
            return;
          }
        }
        if (opts.json || opts.output) {
          process.stdout.write(json);
          return;
        }

        console.log(chalk.bold("Owner ACL Approval Packet"));
        console.log(`  root: ${packet.filters.root_type ?? "all"}`);
        console.log(`  owner: ${packet.filters.owner ?? "all"}`);
        console.log(`  acl: ${packet.filters.acl_review_status ?? "all"}`);
        console.log(`  rows: ${packet.summary.row_count}`);
        console.log(`  duplicate rows: ${packet.summary.duplicate_row_count}`);
        console.log(`  missing target: ${packet.summary.missing_target_count}`);
        console.log(`  samples: ${packet.samples.length}`);
        console.log(chalk.dim("\nCommands"));
        console.log(`  ${packet.commands.sample_rows}`);
        console.log(`  ${packet.commands.duplicate_groups}`);
        console.log(`  ${packet.commands.full_audit_export}`);
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  organize
    .command("export")
    .description("Export organization progress and audit evidence")
    .option("--format <format>", "Export format: json, jsonl, csv", "json")
    .option("--output <path>", "Write export artifact to a file instead of stdout")
    .option("--include-events", "Include organization audit event history")
    .option("-l, --limit <n>", "Max rows per export section; 0 exports all matching rows", "1000")
    .action((opts: OrganizationExportOptions) => {
      requireLocalOrganize("files organize export");
      try {
        const format = parseExportFormat(opts.format);
        const audit = exportFileOrganizationAudit({
          include_events: opts.includeEvents,
          limit: parseLimit(opts.limit, "limit"),
        });
        const text = formatFileOrganizationAuditExport(audit, format);
        if (opts.output) {
          writeFileSync(opts.output, text);
          console.log(chalk.green(`Wrote ${format} organization audit export: ${opts.output}`));
          return;
        }
        process.stdout.write(text);
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  organize
    .command("events <id-or-file-id>")
    .description("List organization audit events for a review or file")
    .option("-l, --limit <n>", "Max rows", "50")
    .option("--json", "Output as JSON")
    .action((idOrFileId: string, opts: { limit: string; json?: boolean }) => {
      requireLocalOrganize("files organize events");
      try {
        const events = listFileOrganizationEvents(idOrFileId, parseLimit(opts.limit, "limit"));
        if (opts.json) {
          printJson(events);
          return;
        }
        for (const event of events) {
          console.log(`${chalk.bold(event.id)}  ${chalk.cyan(event.action)}  ${event.from_status ?? "-"} -> ${event.to_status ?? "-"}  ${chalk.dim(event.created_at)}`);
        }
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });
}

function parseExportFormat(value: string): FileOrganizationAuditExportFormat {
  if (value === "json" || value === "jsonl" || value === "csv") return value;
  throw new Error("format must be one of: json, jsonl, csv");
}
