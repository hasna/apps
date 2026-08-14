import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ENV_KEYS = ["HASNA_FILES_DATA_DIR", "HASNA_FILES_DB_PATH"] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-organization-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
});

afterEach(async () => {
  const { closeDb } = await import("./database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("Drive archive organization queues", () => {
  test("bootstraps review rows, duplicate groups, collections, and audit updates", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { upsertGoogleDriveImportedObject } = await import("./google-drive.js");
    const {
      buildFileOrganizationApprovalPacket,
      bootstrapGoogleDriveOrganizationQueues,
      exportFileOrganizationAudit,
      formatFileOrganizationAuditExport,
      getFileOrganizationStats,
      listFileOrganizationEvents,
      listFileOrganizationDuplicateGroups,
      listFileOrganizationReviews,
      updateFileOrganizationReview,
    } = await import("./organization.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Google Drive (test)",
      type: "google_drive",
      config: {
        profile: "andreihasnacom",
        include_my_drive: true,
        include_all_shared_drives: true,
      },
      machine_id: machine.id,
    });

    for (const index of [1, 2]) {
      const file = upsertFile({
        id: `f_review_${index}`,
        source_id: source.id,
        machine_id: machine.id,
        path: `google-drive/andreihasnacom/my-drive/folder/file-${index}.txt`,
        name: `file-${index}.txt`,
        ext: ".txt",
        size: 70,
        mime: "text/plain",
        hash: `legacy-${index}`,
        status: "active",
        modified_at: "2026-06-08T00:00:00.000Z",
      });
      upsertGoogleDriveImportedObject({
        source_id: source.id,
        drive_id: "my-drive",
        file_id: `drive-file-${index}`,
        profile: "andreihasnacom",
        path: `folder/file-${index}.txt`,
        name: `file-${index}.txt`,
        mime: "text/plain",
        size: 70,
        storage_type: "s3",
        storage_key: `objects/sha256/aa/bb/shared-content-${index}`,
        s3_key: `google-drive/andreihasnacom/my-drive/folder/file-${index}.txt`,
        raw_bucket: "example-files-bucket-archive",
        raw_key: `google-drive/andreihasnacom/my-drive/folder/file-${index}.txt`,
        canonical_bucket: "example-files-bucket",
        canonical_key: `objects/sha256/aa/bb/shared-content-${index}`,
        canonical_sha256: "a".repeat(64),
        promotion_status: "mapped",
        file_record_id: file.id,
        deleted: false,
        last_imported_at: "2026-06-08T00:00:00.000Z",
      });
    }

    const bootstrap = bootstrapGoogleDriveOrganizationQueues();
    expect(bootstrap.scanned).toBe(2);
    expect(bootstrap.created).toBe(2);
    expect(bootstrap.duplicate_rows).toBe(2);
    expect(bootstrap.collections_created).toBeGreaterThanOrEqual(4);

    const stats = getFileOrganizationStats();
    expect(stats.total).toBe(2);
    expect(stats.duplicate_rows).toBe(2);
    expect(stats.acl_needs_review).toBe(2);
    expect(stats.high_risk_permissions).toBe(0);
    expect(stats.by_status).toContainEqual({ review_status: "unreviewed", count: 2 });
    expect(stats.by_root_type).toContainEqual({ root_type: "my_drive", count: 2 });
    expect(stats.by_acl_status).toContainEqual({ acl_review_status: "needs_review", count: 2 });
    expect(stats.by_permission_risk).toContainEqual({ permission_risk: "unknown", count: 2 });

    const reviews = listFileOrganizationReviews({ duplicate_only: true, limit: 10 });
    expect(reviews).toHaveLength(2);
    expect(reviews[0]!.duplicate_group_id?.startsWith("dup_")).toBe(true);
    expect(reviews[0]!.canonical_bucket).toBe("example-files-bucket");
    expect(reviews[0]!.acl_review_status).toBe("needs_review");
    expect(reviews[0]!.permission_scope).toBe("private");
    expect(reviews[0]!.permission_risk).toBe("unknown");
    expect(reviews[0]!.permissions_metadata.source).toBe("inferred_from_drive_root");

    const updated = updateFileOrganizationReview(reviews[0]!.id, {
      status: "moved",
      owner: "finance",
      acl_review_status: "approved",
      permission_scope: "domain",
      permission_risk: "low",
      permission_notes: "Domain-only access approved by finance owner",
      permissions_metadata: { reviewed_by_owner: true },
      target_path: "Finance/Reviewed/file-1.txt",
      labels: ["finance", "reviewed"],
      reviewer: "agent",
      actor: "test-agent",
      note: "test move metadata",
    });
    expect(updated.review_status).toBe("moved");
    expect(updated.owner).toBe("finance");
    expect(updated.acl_review_status).toBe("approved");
    expect(updated.permission_scope).toBe("domain");
    expect(updated.permission_risk).toBe("low");
    expect(updated.permission_notes).toBe("Domain-only access approved by finance owner");
    expect(updated.permissions_metadata.reviewed_by_owner).toBe(true);
    expect(updated.target_path).toBe("Finance/Reviewed/file-1.txt");
    expect(updated.labels).toEqual(["finance", "reviewed"]);

    const events = listFileOrganizationEvents(updated.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("move_metadata");
    expect(events[0]!.from_status).toBe("unreviewed");
    expect(events[0]!.to_status).toBe("moved");

    const aclFiltered = listFileOrganizationReviews({ acl_review_status: "approved", permission_risk: "low", limit: 10 });
    expect(aclFiltered).toHaveLength(1);
    expect(aclFiltered[0]!.id).toBe(updated.id);

    const aclOnly = updateFileOrganizationReview(reviews[1]!.id, {
      acl_review_status: "external_review",
      permission_scope: "external",
      permission_risk: "high",
      actor: "test-agent",
      note: "external ACL needs owner approval",
    });
    expect(aclOnly.acl_review_status).toBe("external_review");
    expect(aclOnly.permission_risk).toBe("high");
    const aclEvents = listFileOrganizationEvents(aclOnly.id);
    expect(aclEvents[0]!.action).toBe("update_acl_review");
    expect(aclEvents[0]!.note).toBe("external ACL needs owner approval");

    const duplicateGroups = listFileOrganizationDuplicateGroups({ include_rows: true });
    expect(duplicateGroups).toHaveLength(1);
    expect(duplicateGroups[0]!.row_count).toBe(2);
    expect(duplicateGroups[0]!.candidate_survivor_review_id).toBe(updated.id);
    expect(duplicateGroups[0]!.owners).toContain("finance");
    expect(duplicateGroups[0]!.owners).toContain("_unassigned");
    expect(duplicateGroups[0]!.needs_owner_review).toBe(true);
    expect(duplicateGroups[0]!.review_reasons).toContain("contains_unassigned_rows");
    expect(duplicateGroups[0]!.rows).toHaveLength(2);

    const unassignedDuplicateGroups = listFileOrganizationDuplicateGroups({
      unassigned: true,
      include_rows: true,
    });
    expect(unassignedDuplicateGroups).toHaveLength(1);
    expect(unassignedDuplicateGroups[0]!.duplicate_group_id).toBe(duplicateGroups[0]!.duplicate_group_id);
    expect(unassignedDuplicateGroups[0]!.unassigned_count).toBe(1);
    expect(unassignedDuplicateGroups[0]!.rows).toHaveLength(2);
    expect(() => listFileOrganizationDuplicateGroups({ owner: "finance", unassigned: true })).toThrow();

    const approvalPacket = buildFileOrganizationApprovalPacket({
      root_type: "my_drive",
      owner: "finance",
      acl_review_status: "approved",
      sample_limit: 5,
      duplicate_limit: 5,
    });
    expect(approvalPacket.summary.row_count).toBe(1);
    expect(approvalPacket.summary.duplicate_row_count).toBe(1);
    expect(approvalPacket.summary.by_acl_status).toContainEqual({ acl_review_status: "approved", count: 1 });
    expect(approvalPacket.summary.by_permission_risk).toContainEqual({ permission_risk: "low", count: 1 });
    expect(approvalPacket.duplicate_groups).toHaveLength(1);
    expect(approvalPacket.samples).toHaveLength(1);
    expect(approvalPacket.samples[0]!.review_id).toBe(updated.id);
    expect(approvalPacket.commands.sample_rows).toContain("files organize list --root-type my_drive --owner finance --acl-status approved");
    expect(approvalPacket.guardrails).toContain("Do not rewrite canonical S3 object keys as part of ACL approval.");

    const audit = exportFileOrganizationAudit({ include_events: true, limit: 10 });
    expect(audit.summary.unresolved_count).toBeGreaterThanOrEqual(1);
    expect(audit.summary.moved_count).toBe(1);
    expect(audit.summary.permission_risk_count).toBeGreaterThanOrEqual(1);
    expect(audit.moved_rows[0]!.review_id).toBe(updated.id);
    expect(audit.permission_risk_rows.some((row) => row.review_id === aclOnly.id)).toBe(true);
    expect(audit.events?.some((event) => event.action === "update_acl_review")).toBe(true);

    const jsonl = formatFileOrganizationAuditExport(audit, "jsonl");
    expect(jsonl).toContain("\"section\":\"summary\"");
    expect(jsonl).toContain("\"section\":\"events\"");

    const csv = formatFileOrganizationAuditExport(audit, "csv");
    expect(csv.split("\n")[0]).toContain("section,review_id,file_id");
  });

  test("stages shared-drive owner and target candidates without approving ACLs", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { upsertGoogleDriveImportedObject } = await import("./google-drive.js");
    const {
      buildFileOrganizationApprovalPacket,
      bootstrapGoogleDriveOrganizationQueues,
      getFileOrganizationStats,
      inferGoogleDriveOrganizationCandidates,
      listFileOrganizationEvents,
      listFileOrganizationReviews,
    } = await import("./organization.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Google Drive (shared test)",
      type: "google_drive",
      config: {
        profile: "andreihasnacom",
        include_my_drive: true,
        include_all_shared_drives: true,
      },
      machine_id: machine.id,
    });

    for (const [index, topLevel] of ["Finance", "Product"].entries()) {
      const file = upsertFile({
        id: `f_shared_review_${index}`,
        source_id: source.id,
        machine_id: machine.id,
        path: `google-drive/andreihasnacom/${topLevel}/folder/file-${index}.pdf`,
        name: `file-${index}.pdf`,
        ext: ".pdf",
        size: 700 + index,
        mime: "application/pdf",
        hash: `legacy-shared-${index}`,
        status: "active",
        modified_at: "2026-06-08T00:00:00.000Z",
      });
      upsertGoogleDriveImportedObject({
        source_id: source.id,
        drive_id: "shared-drive",
        file_id: `shared-drive-file-${index}`,
        profile: "andreihasnacom",
        path: `andreihasnacom/${topLevel}/folder/file-${index}.pdf`,
        name: `file-${index}.pdf`,
        mime: "application/pdf",
        size: 700 + index,
        storage_type: "s3",
        storage_key: `objects/sha256/cc/dd/shared-file-${index}`,
        s3_key: `google-drive/andreihasnacom/${topLevel}/folder/file-${index}.pdf`,
        raw_bucket: "example-files-bucket-archive",
        raw_key: `imports/google-drive/legacy-s3-2026-06-07/raw/andreihasnacom/${topLevel}/folder/file-${index}.pdf`,
        canonical_bucket: "example-files-bucket",
        canonical_key: `objects/sha256/cc/dd/shared-file-${index}`,
        canonical_sha256: `${index}`.repeat(64),
        promotion_status: "mapped",
        file_record_id: file.id,
        deleted: false,
        last_imported_at: "2026-06-08T00:00:00.000Z",
      });
    }

    bootstrapGoogleDriveOrganizationQueues();

    const dryRun = inferGoogleDriveOrganizationCandidates({ root_type: "shared_drive" });
    expect(dryRun.dry_run).toBe(true);
    expect(dryRun.scanned).toBe(2);
    expect(dryRun.matched).toBe(2);
    expect(dryRun.updated).toBe(0);
    expect(dryRun.by_owner).toContainEqual({ owner: "finance", count: 1 });
    expect(dryRun.by_owner).toContainEqual({ owner: "product", count: 1 });

    const applied = inferGoogleDriveOrganizationCandidates({
      root_type: "shared_drive",
      apply: true,
      actor: "test-agent",
    });
    expect(applied.updated).toBe(2);

    const stats = getFileOrganizationStats();
    expect(stats.unassigned_owner).toBe(0);
    expect(stats.missing_target).toBe(0);
    expect(stats.acl_needs_review).toBe(2);
    expect(stats.by_status).toContainEqual({ review_status: "in_review", count: 2 });

    const reviews = listFileOrganizationReviews({ root_type: "shared_drive", limit: 10 });
    expect(reviews.map((review) => review.owner).sort()).toEqual(["finance", "product"]);
    expect(reviews.every((review) => review.acl_review_status === "needs_review")).toBe(true);
    expect(reviews.every((review) => review.permission_risk === "unknown")).toBe(true);
    expect(reviews.every((review) => review.target_path?.includes("/folder/file-"))).toBe(true);

    const financePacket = buildFileOrganizationApprovalPacket({
      root_type: "shared_drive",
      owner: "finance",
      acl_review_status: "needs_review",
    });
    expect(financePacket.summary.row_count).toBe(1);
    expect(financePacket.summary.missing_target_count).toBe(0);
    expect(financePacket.summary.by_top_level).toContainEqual({ top_level: "Finance", count: 1, size: 700 });
    expect(financePacket.summary.by_permission_scope).toContainEqual({ permission_scope: "shared_drive", count: 1 });
    expect(financePacket.samples[0]!.owner).toBe("finance");
    expect(financePacket.commands.duplicate_groups).toContain("files organize duplicates --root-type shared_drive --owner finance");

    const events = listFileOrganizationEvents(reviews[0]!.id);
    expect(events[0]!.action).toBe("update_acl_review");
    expect(events[0]!.actor).toBe("test-agent");
    expect(events[0]!.note).toContain("ACL remains needs_review");
  });

  test("stages conservative My Drive owner and target candidates", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { upsertGoogleDriveImportedObject } = await import("./google-drive.js");
    const {
      buildFileOrganizationApprovalPacket,
      bootstrapGoogleDriveOrganizationQueues,
      getFileOrganizationStats,
      inferGoogleDriveOrganizationCandidates,
      listFileOrganizationEvents,
      listFileOrganizationReviews,
      listFileOrganizationUnassignedGroups,
    } = await import("./organization.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Google Drive (my drive test)",
      type: "google_drive",
      config: {
        profile: "andreihasnacom",
        include_my_drive: true,
      },
      machine_id: machine.id,
    });

    const rows = [
      ["f_my_drive_people", "HR & People/Hiring/file-people.pdf"],
      ["f_my_drive_finance", "Finance/Invoices/file-finance.pdf"],
      ["f_my_drive_unknown", "USB and External Devices/Disk/file-unknown.pdf"],
    ] as const;

    for (const [index, [fileId, drivePath]] of rows.entries()) {
      const file = upsertFile({
        id: fileId,
        source_id: source.id,
        machine_id: machine.id,
        path: `google-drive/andreihasnacom/my-drive/${drivePath}`,
        name: `file-${index}.pdf`,
        ext: ".pdf",
        size: 900 + index,
        mime: "application/pdf",
        hash: `legacy-my-drive-${index}`,
        status: "active",
        modified_at: "2026-06-09T00:00:00.000Z",
      });
      upsertGoogleDriveImportedObject({
        source_id: source.id,
        drive_id: "my-drive",
        file_id: `my-drive-file-${index}`,
        profile: "andreihasnacom",
        path: `andreihasnacom/my-drive/${drivePath}`,
        name: `file-${index}.pdf`,
        mime: "application/pdf",
        size: 900 + index,
        storage_type: "s3",
        storage_key: `objects/sha256/ee/ff/my-drive-file-${index}`,
        s3_key: `google-drive/andreihasnacom/my-drive/${drivePath}`,
        raw_bucket: "example-files-bucket-archive",
        raw_key: `google-drive/andreihasnacom/my-drive/${drivePath}`,
        canonical_bucket: "example-files-bucket",
        canonical_key: `objects/sha256/ee/ff/my-drive-file-${index}`,
        canonical_sha256: `${index}`.repeat(64),
        promotion_status: "mapped",
        file_record_id: file.id,
        deleted: false,
        last_imported_at: "2026-06-09T00:00:00.000Z",
      });
    }

    bootstrapGoogleDriveOrganizationQueues();

    const dryRun = inferGoogleDriveOrganizationCandidates({ root_type: "my_drive" });
    expect(dryRun.dry_run).toBe(true);
    expect(dryRun.scanned).toBe(3);
    expect(dryRun.matched).toBe(2);
    expect(dryRun.updated).toBe(0);
    expect(dryRun.skipped).toBe(1);
    expect(dryRun.by_owner).toContainEqual({ owner: "people", count: 1 });
    expect(dryRun.by_owner).toContainEqual({ owner: "finance", count: 1 });

    const applied = inferGoogleDriveOrganizationCandidates({
      root_type: "my_drive",
      apply: true,
      actor: "test-agent",
    });
    expect(applied.updated).toBe(2);

    const stats = getFileOrganizationStats();
    expect(stats.unassigned_owner).toBe(1);
    expect(stats.missing_target).toBe(1);
    expect(stats.acl_needs_review).toBe(3);
    expect(stats.by_status).toContainEqual({ review_status: "in_review", count: 2 });
    expect(stats.by_status).toContainEqual({ review_status: "unreviewed", count: 1 });

    const staged = listFileOrganizationReviews({ root_type: "my_drive", status: "in_review", limit: 10 });
    expect(staged.map((review) => review.owner).sort()).toEqual(["finance", "people"]);
    expect(staged.every((review) => review.labels.includes("my-drive"))).toBe(true);
    expect(staged.every((review) => review.acl_review_status === "needs_review")).toBe(true);
    expect(staged.every((review) => review.permission_risk === "unknown")).toBe(true);

    const peoplePacket = buildFileOrganizationApprovalPacket({
      root_type: "my_drive",
      owner: "people",
      acl_review_status: "needs_review",
    });
    expect(peoplePacket.summary.row_count).toBe(1);
    expect(peoplePacket.summary.by_top_level).toContainEqual({ top_level: "HR & People", count: 1, size: 900 });
    expect(peoplePacket.samples[0]!.target_path).toBe("HR & People/Hiring/file-people.pdf");
    expect(peoplePacket.commands.post_approval_update).toContain("files organize review <review_id>");

    const unreviewed = listFileOrganizationReviews({ root_type: "my_drive", status: "unreviewed", limit: 10 });
    expect(unreviewed).toHaveLength(1);
    expect(unreviewed[0]!.owner).toBeUndefined();
    expect(unreviewed[0]!.target_path).toBeUndefined();

    const unassignedGroups = listFileOrganizationUnassignedGroups({
      root_type: "my_drive",
      include_rows: true,
    });
    expect(unassignedGroups).toHaveLength(1);
    expect(unassignedGroups[0]!.top_level).toBe("USB and External Devices");
    expect(unassignedGroups[0]!.row_count).toBe(1);
    expect(unassignedGroups[0]!.suggested_review_track).toBe("external-device-archive-owner-review");
    expect(unassignedGroups[0]!.review_reasons).toContain("external_device_archive");
    expect(unassignedGroups[0]!.rows).toHaveLength(1);
    expect(listFileOrganizationUnassignedGroups({ root_type: "my_drive", top_level: "USB and External Devices" })).toHaveLength(1);
    expect(listFileOrganizationUnassignedGroups({ root_type: "my_drive", top_level: "Archive" })).toHaveLength(0);
    expect(listFileOrganizationUnassignedGroups({
      root_type: "my_drive",
      exclude_top_levels: ["USB and External Devices"],
    })).toHaveLength(0);
    expect(() => listFileOrganizationUnassignedGroups({
      top_level: "USB and External Devices",
      exclude_top_levels: ["Archive"],
    })).toThrow();

    const events = listFileOrganizationEvents(staged[0]!.id);
    expect(events[0]!.action).toBe("update_acl_review");
    expect(events[0]!.actor).toBe("test-agent");
    expect(events[0]!.note).toContain("ACL remains needs_review");
  });

  test("applies unified Drive policy as metadata-only normalized organization", async () => {
    const { getCurrentMachine } = await import("./machines.js");
    const { createSource } = await import("./sources.js");
    const { upsertFile } = await import("./files.js");
    const { upsertGoogleDriveImportedObject } = await import("./google-drive.js");
    const { getDb } = await import("./database.js");
    const {
      applyGoogleDriveUnifiedOrganizationPolicy,
      bootstrapGoogleDriveOrganizationQueues,
      getFileOrganizationReview,
      getFileOrganizationStats,
      listFileOrganizationEvents,
    } = await import("./organization.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Google Drive (unified policy test)",
      type: "google_drive",
      config: {
        profile: "andreihasnacom",
        include_my_drive: true,
        include_all_shared_drives: true,
      },
      machine_id: machine.id,
    });

    const rows = [
      {
        fileId: "f_policy_shared_old",
        driveId: "shared-drive",
        driveFileId: "policy-shared-old",
        path: "andreihasnacom/Finance/Reports/Old Report.PDF",
        rawKey: "google-drive/andreihasnacom/Finance/Reports/Old Report.PDF",
        name: "Old Report.PDF",
        sha: "d".repeat(64),
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        fileId: "f_policy_my_new",
        driveId: "my-drive",
        driveFileId: "policy-my-new",
        path: "andreihasnacom/my-drive/Finance/Reports/Latest Report.PDF",
        rawKey: "google-drive/andreihasnacom/my-drive/Finance/Reports/Latest Report.PDF",
        name: "Latest Report.PDF",
        sha: "d".repeat(64),
        modifiedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        fileId: "f_policy_people",
        driveId: "my-drive",
        driveFileId: "policy-people",
        path: "andreihasnacom/my-drive/HR & People/Hiring/Person File.pdf",
        rawKey: "google-drive/andreihasnacom/my-drive/HR & People/Hiring/Person File.pdf",
        name: "Person File.pdf",
        sha: "e".repeat(64),
        modifiedAt: "2026-01-15T00:00:00.000Z",
      },
      {
        fileId: "f_policy_loose",
        driveId: "my-drive",
        driveFileId: "policy-loose",
        path: "andreihasnacom/my-drive/Loose Root.pdf",
        rawKey: "google-drive/andreihasnacom/my-drive/Loose Root.pdf",
        name: "Loose Root.pdf",
        sha: "f".repeat(64),
        modifiedAt: "2026-01-20T00:00:00.000Z",
      },
    ];

    for (const [index, row] of rows.entries()) {
      const file = upsertFile({
        id: row.fileId,
        source_id: source.id,
        machine_id: machine.id,
        path: row.rawKey,
        name: row.name,
        ext: ".pdf",
        size: 1000 + index,
        mime: "application/pdf",
        hash: `legacy-policy-${index}`,
        status: "active",
        modified_at: row.modifiedAt,
      });
      upsertGoogleDriveImportedObject({
        source_id: source.id,
        drive_id: row.driveId,
        file_id: row.driveFileId,
        profile: "andreihasnacom",
        path: row.path,
        name: row.name,
        mime: "application/pdf",
        size: 1000 + index,
        storage_type: "s3",
        storage_key: `objects/sha256/policy/${index}`,
        s3_key: row.rawKey,
        raw_bucket: "example-files-bucket-archive",
        raw_key: row.rawKey,
        canonical_bucket: "example-files-bucket",
        canonical_key: `objects/sha256/policy/${index}`,
        canonical_sha256: row.sha,
        promotion_status: "mapped",
        file_record_id: file.id,
        deleted: false,
        last_imported_at: "2026-06-15T00:00:00.000Z",
      });
    }

    bootstrapGoogleDriveOrganizationQueues();

    const dryRun = applyGoogleDriveUnifiedOrganizationPolicy({ actor: "test-agent" });
    expect(dryRun.dry_run).toBe(true);
    expect(dryRun.scanned).toBe(4);
    expect(dryRun.planned_updates).toBe(4);
    expect(dryRun.duplicate_groups).toBe(1);
    expect(dryRun.duplicate_rows).toBe(1);
    expect(dryRun.by_owner).toContainEqual({ owner: "finance", count: 2 });
    expect(dryRun.by_owner).toContainEqual({ owner: "people", count: 1 });
    expect(dryRun.by_owner).toContainEqual({ owner: "intake", count: 1 });

    expect(getFileOrganizationStats().acl_needs_review).toBe(4);

    const beforeCanonical = getDb()
      .query<{ canonical_key: string | null }, [string]>(
        "SELECT canonical_key FROM google_drive_imported_objects WHERE file_record_id = ?",
      )
      .get("f_policy_my_new")?.canonical_key;

    const applied = applyGoogleDriveUnifiedOrganizationPolicy({ apply: true, actor: "test-agent" });
    expect(applied.dry_run).toBe(false);
    expect(applied.planned_updates).toBe(4);

    const latest = getFileOrganizationReview("f_policy_my_new")!;
    expect(latest.review_status).toBe("approved");
    expect(latest.owner).toBe("finance");
    expect(latest.target_path).toBe("finance/reports/latest-report.pdf");
    expect(latest.acl_review_status).toBe("approved");
    expect(latest.permission_scope).toBe("domain");
    expect(latest.permission_risk).toBe("low");
    expect(latest.permissions_metadata.unified_drive_policy).toMatchObject({
      permission_mode: "broad_additive",
      duplicate_survivor: true,
      storage_action: "metadata_only_no_s3_rewrite",
    });

    const older = getFileOrganizationReview("f_policy_shared_old")!;
    expect(older.review_status).toBe("duplicate");
    expect(older.owner).toBe("finance");
    expect(older.permissions_metadata.unified_drive_policy).toMatchObject({
      action: "mark_duplicate",
      duplicate_survivor: false,
    });

    const people = getFileOrganizationReview("f_policy_people")!;
    expect(people.owner).toBe("people");
    expect(people.target_path).toBe("people/hiring/person-file.pdf");

    const loose = getFileOrganizationReview("f_policy_loose")!;
    expect(loose.owner).toBe("intake");
    expect(loose.target_path).toBe("intake/unassigned/loose-root.pdf");

    const afterCanonical = getDb()
      .query<{ canonical_key: string | null }, [string]>(
        "SELECT canonical_key FROM google_drive_imported_objects WHERE file_record_id = ?",
      )
      .get("f_policy_my_new")?.canonical_key;
    expect(afterCanonical).toBe(beforeCanonical);

    const events = listFileOrganizationEvents(latest.id);
    expect(events[0]!.actor).toBe("test-agent");
    expect(events[0]!.note).toContain("without rewriting S3 objects");
  });
});
