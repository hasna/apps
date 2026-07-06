import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// Capture prior values so the global process.env mutations below are restored
// in afterAll — otherwise these leak into later CLI tests that spread
// ...process.env into spawned subprocesses (e.g. storage status).
const POLLUTED_ENV_KEYS = [
  "HASNA_FILES_DATA_DIR",
  "HASNA_FILES_DB_PATH",
  "HASNA_FILES_EVIDENCE_STORAGE",
  "HASNA_FILES_EVIDENCE_LOCAL_ROOT",
] as const;
const priorEnv: Record<string, string | undefined> = Object.fromEntries(
  POLLUTED_ENV_KEYS.map((k) => [k, process.env[k]]),
);

const testDir = mkdtempSync(join(tmpdir(), "open-files-evidence-"));
process.env.HASNA_FILES_DATA_DIR = testDir;
process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
process.env.HASNA_FILES_EVIDENCE_STORAGE = "local";
process.env.HASNA_FILES_EVIDENCE_LOCAL_ROOT = join(testDir, "evidence");

const { closeDb } = await import("../db/database.js");
const {
  completeEvidenceUpload,
  createEvidenceUploadIntent,
  linkEvidenceAsset,
  listFileAccessEvents,
  listFileLinks,
  signEvidenceDownload,
  uploadEvidenceFile,
  verifyEvidenceAsset,
} = await import("./evidence.js");
const { sha256Buffer } = await import("./hasher.js");

beforeEach(() => {
  closeDb();
  rmSync(process.env.HASNA_FILES_DB_PATH!, { force: true });
  rmSync(`${process.env.HASNA_FILES_DB_PATH!}-shm`, { force: true });
  rmSync(`${process.env.HASNA_FILES_DB_PATH!}-wal`, { force: true });
  rmSync(evidenceRoot(), { recursive: true, force: true });
  rmSync(fixtureRoot(), { recursive: true, force: true });
  mkdirSync(evidenceRoot(), { recursive: true });
  mkdirSync(fixtureRoot(), { recursive: true });
});

afterAll(() => {
  closeDb();
  rmSync(testDir, { recursive: true, force: true });
  // Restore global env so these do not leak into later CLI tests.
  for (const k of POLLUTED_ENV_KEYS) {
    if (priorEnv[k] === undefined) delete process.env[k];
    else process.env[k] = priorEnv[k];
  }
});

describe("evidence vault", () => {
  test("uploads, verifies, links, signs, and audits a local evidence asset", async () => {
    const fixture = join(fixtureRoot(), "receipt.txt");
    writeFileSync(fixture, "receipt bytes");

    const result = await uploadEvidenceFile({
      path: fixture,
      org_id: "org_hasna",
      company_id: "co_us",
      app: "iapp-accounting",
      kind: "receipt",
      classification: "financial_evidence",
      retention_policy: "tax_evidence",
      storage_class: "STANDARD_IA",
      legal_hold: true,
      immutable: true,
      metadata: { invoice_id: "inv_1" },
    }, { provider: "local", localRoot: evidenceRoot() });

    expect(result.asset.status).toBe("verified");
    expect(result.asset.scan_status).toBe("skipped");
    expect(result.asset.bucket).toBeUndefined();
    expect(result.asset.retention_policy).toBe("tax_evidence");
    expect(result.asset.storage_class).toBe("STANDARD_IA");
    expect(result.asset.legal_hold).toBe(true);
    expect(result.asset.immutable).toBe(true);
    expect(existsSync(join(evidenceRoot(), result.asset.object_key))).toBe(true);
    expect(existsSync(join(evidenceRoot(), result.asset.quarantine_key!))).toBe(false);

    const link = linkEvidenceAsset({
      asset_id: result.asset.id,
      org_id: "org_hasna",
      company_id: "co_us",
      app: "iapp-accounting",
      source_type: "invoice",
      source_id: "inv_1",
      kind: "supporting_document",
    });
    expect(link.asset_id).toBe(result.asset.id);

    const grant = await signEvidenceDownload({
      asset_id: result.asset.id,
      actor_id: "agent_test",
      purpose: "audit_test",
    }, { provider: "local", localRoot: evidenceRoot() });
    expect(grant.url.startsWith("file://")).toBe(true);

    const verification = await verifyEvidenceAsset(result.asset.id, { provider: "local", localRoot: evidenceRoot() });
    expect(verification.ok).toBe(true);
    expect(verification.diagnostics).toEqual([]);

    expect(listFileLinks(result.asset.id)).toHaveLength(1);
    const actions = listFileAccessEvents(result.asset.id, 20).map((event) => event.action);
    expect(actions).toContain("create_upload");
    expect(actions).toContain("complete_upload");
    expect(actions).toContain("link");
    expect(actions).toContain("sign_download");
    expect(actions).toContain("verify");
  });

  test("rejects checksum mismatches and blocks links until verification succeeds", async () => {
    const result = await createEvidenceUploadIntent({
      org_id: "org_hasna",
      company_id: "co_us",
      app: "iapp-accounting",
      kind: "receipt",
      original_name: "receipt.txt",
      content_type: "text/plain",
      size: Buffer.byteLength("actual bytes"),
      checksum: sha256("expected bytes"),
    }, { provider: "local", localRoot: evidenceRoot() });

    const uploadPath = fileURLToPath(result.intent.upload_url!);
    mkdirSync(dirname(uploadPath), { recursive: true });
    writeFileSync(uploadPath, "actual bytes");

    await expect(completeEvidenceUpload(result.intent.id, { provider: "local", localRoot: evidenceRoot() }))
      .rejects.toThrow("checksum_mismatch");

    expect(() => linkEvidenceAsset({
      asset_id: result.asset.id,
      org_id: "org_hasna",
      company_id: "co_us",
      app: "iapp-accounting",
      source_type: "invoice",
      source_id: "inv_1",
      kind: "supporting_document",
    })).toThrow("must be verified");
  });
});

function evidenceRoot(): string {
  return process.env.HASNA_FILES_EVIDENCE_LOCAL_ROOT!;
}

function fixtureRoot(): string {
  return join(testDir, "fixtures");
}

function sha256(value: string): string {
  return sha256Buffer(Buffer.from(value));
}
