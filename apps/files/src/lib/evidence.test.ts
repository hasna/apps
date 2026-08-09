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
  listFileAssets,
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
    // The resolved local root is persisted as the asset's storage container so
    // later invocations can locate the bytes without re-passing --local-root.
    expect(result.asset.bucket).toBe(evidenceRoot());
    expect(result.asset.retention_policy).toBe("tax_evidence");
    expect(result.asset.storage_class).toBe("STANDARD_IA");
    expect(result.asset.legal_hold).toBe(true);
    expect(result.asset.immutable).toBe(true);
    expect(result.intent.upload_url).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("upload_url");
    expect(existsSync(join(evidenceRoot(), result.asset.object_key))).toBe(true);
    expect(existsSync(join(evidenceRoot(), result.asset.quarantine_key!))).toBe(false);

    const link = await linkEvidenceAsset({
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

    await expect(linkEvidenceAsset({
      asset_id: result.asset.id,
      org_id: "org_hasna",
      company_id: "co_us",
      app: "iapp-accounting",
      source_type: "invoice",
      source_id: "inv_1",
      kind: "supporting_document",
    })).rejects.toThrow("must be verified");
  });

  test("stores authority metadata and replays the same immutable evidence deterministically", async () => {
    const fixture = join(fixtureRoot(), "synthetic-evidence.txt");
    writeFileSync(fixture, "synthetic immutable evidence");
    const input = {
      path: fixture,
      org_id: "org_synthetic",
      company_id: "co_synthetic",
      app: "iapp-monthly-filing",
      kind: "supporting_document",
      classification: "restricted",
      retention_policy: "seven_year_records",
      immutable: true,
      provenance_type: "monthly_filing",
      provenance_id: "filing_synthetic_1",
      provenance_ref: "monthly-filing://filing/synthetic-1",
      version: 3,
      external_references: [
        "accounting://journal/synthetic-42",
        "invoices://invoice/synthetic-42",
      ],
      idempotency_key: "monthly-filing:synthetic-1:v3",
    } as const;

    const first = await uploadEvidenceFile(input, { provider: "local", localRoot: evidenceRoot() });
    const replay = await uploadEvidenceFile(input, { provider: "local", localRoot: evidenceRoot() });
    const otherScope = await uploadEvidenceFile(
      { ...input, org_id: "org_synthetic_other" },
      { provider: "local", localRoot: evidenceRoot() },
    );

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(otherScope.replayed).toBe(false);
    expect(otherScope.asset.id).not.toBe(first.asset.id);
    expect(replay.asset.id).toBe(first.asset.id);
    expect(replay.intent.id).toBe(first.intent.id);
    expect(first.asset).toMatchObject({
      version: 3,
      provenance_type: "monthly_filing",
      provenance_id: "filing_synthetic_1",
      provenance_ref: "monthly-filing://filing/synthetic-1",
      classification: "restricted",
      retention_policy: "seven_year_records",
      immutable: true,
      idempotency_key: "monthly-filing:synthetic-1:v3",
    });
    expect(first.asset.canonical_ref).toBe(`open-files://evidence/${first.asset.id}/versions/3`);
    expect(first.asset.external_references).toEqual([
      "accounting://journal/synthetic-42",
      "invoices://invoice/synthetic-42",
    ]);
    expect(JSON.stringify(first)).not.toContain("synthetic immutable evidence");

    const filtered = listFileAssets({
      org_id: "org_synthetic",
      app: "iapp-monthly-filing",
      provenance_type: "monthly_filing",
      provenance_id: "filing_synthetic_1",
      provenance_ref: "monthly-filing://filing/synthetic-1",
      version: 3,
      classification: "restricted",
      retention_policy: "seven_year_records",
      external_reference: "invoices://invoice/synthetic-42",
    });
    expect(filtered.map((asset) => asset.id)).toEqual([first.asset.id]);
    expect(listFileAssets({ external_reference: "invoices://invoice/absent" })).toEqual([]);
  });

  test("rejects mutation attempts against an immutable replay key", async () => {
    const fixture = join(fixtureRoot(), "synthetic-mutation.txt");
    writeFileSync(fixture, "original synthetic bytes");
    const base = {
      path: fixture,
      org_id: "org_synthetic",
      app: "iapp-monthly-filing",
      kind: "supporting_document",
      provenance_type: "monthly_filing",
      provenance_id: "filing_synthetic_2",
      version: 1,
      idempotency_key: "monthly-filing:synthetic-2:v1",
    } as const;

    const original = await uploadEvidenceFile(base, { provider: "local", localRoot: evidenceRoot() });
    writeFileSync(fixture, "mutated synthetic bytes");

    await expect(uploadEvidenceFile(base, { provider: "local", localRoot: evidenceRoot() }))
      .rejects.toThrow(/immutable evidence replay conflict/i);
    expect(listFileAssets({ idempotency_key: base.idempotency_key }).map((asset) => asset.id))
      .toEqual([original.asset.id]);

    await expect(uploadEvidenceFile(
      { ...base, idempotency_key: "monthly-filing:synthetic-3:v1", immutable: false },
      { provider: "local", localRoot: evidenceRoot() },
    )).rejects.toThrow(/immutable/i);
  });

  test("concurrent identical idempotency requests converge on one asset and one intent", async () => {
    const input = {
      org_id: "org_concurrent_synthetic",
      app: "iapp-monthly-filing",
      kind: "supporting_document",
      original_name: "synthetic-concurrent.txt",
      content_type: "text/plain",
      size: 9,
      checksum: sha256("synthetic"),
      provenance_type: "monthly_filing",
      provenance_id: "filing_concurrent_synthetic",
      idempotency_key: "monthly-filing:concurrent-synthetic:v1",
    } as const;

    const [first, second] = await Promise.all([
      createEvidenceUploadIntent(input, { provider: "local", localRoot: evidenceRoot() }),
      createEvidenceUploadIntent(input, { provider: "local", localRoot: evidenceRoot() }),
    ]);

    expect(first.asset.id).toBe(second.asset.id);
    expect(first.intent.id).toBe(second.intent.id);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(listFileAssets({ idempotency_key: input.idempotency_key })).toHaveLength(1);
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
