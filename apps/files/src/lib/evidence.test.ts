import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

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
      app: "app-accounting",
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
      app: "app-accounting",
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
      app: "app-accounting",
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
      app: "app-accounting",
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
      app: "app-monthly-filing",
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
      app: "app-monthly-filing",
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
      app: "app-monthly-filing",
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
      app: "app-monthly-filing",
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

describe("evidence storage alignment (hasna/apps#1650)", () => {
  test("new uploads land under the canonical content-addressed layout", async () => {
    const fixture = join(fixtureRoot(), "canonical-receipt.txt");
    writeFileSync(fixture, "canonical bytes");

    const result = await uploadEvidenceFile({
      path: fixture,
      org_id: "org_hasna",
      app: "app-accounting",
      kind: "receipt",
      original_name: "canonical-receipt.txt",
    }, { provider: "local", localRoot: evidenceRoot() });

    expect(result.asset.status).toBe("verified");
    expect(result.asset.object_key).toMatch(
      new RegExp(`^evidence/org_hasna/[a-f0-9]{64}\\.txt$`),
    );
    expect(result.asset.quarantine_key).toMatch(/^quarantine\/evidence\/org_hasna\//);
    expect(result.asset.object_key).toContain(result.asset.checksum);
    expect(existsSync(join(evidenceRoot(), result.asset.object_key))).toBe(true);
  });

  test("duplicate non-idempotent uploads share one final object (dedup by content)", async () => {
    const fixture = join(fixtureRoot(), "dup.txt");
    writeFileSync(fixture, "identical evidence bytes");

    const first = await uploadEvidenceFile({
      path: fixture,
      org_id: "org_hasna",
      app: "app-accounting",
      kind: "receipt",
    }, { provider: "local", localRoot: evidenceRoot() });
    const second = await uploadEvidenceFile({
      path: fixture,
      org_id: "org_hasna",
      app: "app-accounting",
      kind: "receipt",
    }, { provider: "local", localRoot: evidenceRoot() });

    expect(first.asset.id).not.toBe(second.asset.id); // no idempotency convergence
    expect(second.asset.object_key).toBe(first.asset.object_key); // content address
    expect(second.asset.checksum).toBe(first.asset.checksum);
    expect(listFileAssets({ app: "app-accounting" })).toHaveLength(2);
  });

  test("legacy orgs/ keys stay readable through verify and sign (shim)", async () => {
    const { createFileAssetConvergent, updateFileAssetStatus } = await import("../db/evidence.js");
    const legacyKey = "orgs/org_hasna/companies/_global/app-accounting/2026/09/receipt/asset_legacy1/old-name.txt";
    const legacy = createFileAssetConvergent({
      id: "asset_legacy1",
      org_id: "org_hasna",
      app: "app-accounting",
      kind: "receipt",
      original_name: "old-name.txt",
      content_type: "text/plain",
      size: Buffer.byteLength("legacy bytes"),
      checksum: sha256("legacy bytes"),
      checksum_algorithm: "sha256",
      storage_provider: "local",
      bucket: evidenceRoot(),
      object_key: legacyKey,
    }).asset;
    updateFileAssetStatus({ id: legacy.id, status: "verified", scan_status: "skipped", verified: true });

    // Bytes live at the stored legacy key — reads must resolve it verbatim.
    const legacyPath = join(evidenceRoot(), legacyKey);
    mkdirSync(dirname(legacyPath), { recursive: true });
    writeFileSync(legacyPath, "legacy bytes");

    const verification = await verifyEvidenceAsset(legacy.id, { provider: "local", localRoot: evidenceRoot() });
    expect(verification.ok).toBe(true);
    expect(verification.diagnostics).toEqual([]);

    const grant = await signEvidenceDownload(
      { asset_id: legacy.id, purpose: "legacy_test" },
      { provider: "local", localRoot: evidenceRoot() },
    );
    expect(grant.url).toBe(pathToFileURL(legacyPath).toString());
  });

  test("S3 complete dedups: a duplicate upload skips the copy and writes only its manifest", async () => {
    const { setS3ClientFactoryForTests } = await import("./s3.js");
    const { S3Client } = await import("@aws-sdk/client-s3");
    // A REAL client is required so getSignedUrl can SignV4-sign the presigned
    // PUT; its send is overridden below so byte operations land in the fake
    // bucket instead of the network (getSignedUrl never calls send).
    const real = new S3Client({
      region: "us-east-1",
      credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
      endpoint: "http://127.0.0.1:9", // never contacted
      forcePathStyle: true,
    });
    const fake = new FakeEvidenceBucket();
    const client = real as unknown as {
      send: (cmd: unknown) => Promise<unknown>;
    };
    client.send = async (cmd) => fake.send(cmd as never);
    setS3ClientFactoryForTests(() => real as never);
    try {
      const fixture = join(fixtureRoot(), "s3-dup.bin");
      writeFileSync(fixture, "s3 duplicate bytes");

      const storage = { provider: "s3" as const, bucket: "test-bucket", profile: "test" };
      const first = await uploadEvidenceFile({
        path: fixture,
        org_id: "org_hasna",
        app: "app-accounting",
        kind: "receipt",
      }, storage);
      const second = await uploadEvidenceFile({
        path: fixture,
        org_id: "org_hasna",
        app: "app-accounting",
        kind: "receipt",
      }, storage);

      expect(first.asset.id).not.toBe(second.asset.id);
      expect(second.asset.object_key).toBe(first.asset.object_key);
      expect(second.asset.status).toBe("verified");

      expect(fake.copies).toHaveLength(1); // only the first upload copy from quarantine
      expect(fake.deletes.length).toBe(2); // both quarantine objects removed
      const blobs = [...fake.objects.keys()].filter((k) => k.includes("/manifests/") === false);
      expect(blobs).toHaveLength(1); // duplicate upload leaves ONE final object
      const manifests = [...fake.objects.keys()].filter((k) => k.includes("/manifests/"));
      expect(manifests).toHaveLength(2); // one immutable manifest per asset
      for (const key of blobs) {
        expect(fake.objects.get(key)!.toString("utf-8")).toBe("s3 duplicate bytes");
      }
    } finally {
      setS3ClientFactoryForTests(undefined);
    }
  });
});

class FakeEvidenceBucket {
  objects = new Map<string, Buffer>();
  metadata = new Map<string, Record<string, string>>();
  copies: string[] = [];
  deletes: string[] = [];

  async send(command: { constructor: { name: string }; input: Record<string, unknown> }): Promise<unknown> {
    const input = command.input as {
      Bucket?: string;
      Key?: string;
      Body?: Buffer | string | Uint8Array | NodeJS.ReadableStream;
      Metadata?: Record<string, string>;
      ChecksumSHA256?: string;
      ContentType?: string;
      CopySource?: string;
      MetadataDirective?: string;
    };
    switch (command.constructor.name) {
      case "PutObjectCommand": {
        const key = input.Key!;
        this.objects.set(key, await bodyToBuffer(input.Body));
        if (input.Metadata) this.metadata.set(key, { ...input.Metadata });
        return {};
      }
      case "HeadObjectCommand": {
        const key = input.Key!;
        const body = this.objects.get(key);
        if (!body) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        const meta = this.metadata.get(key) ?? {};
        return {
          ContentLength: body.byteLength,
          ContentType: input.ContentType ?? "application/octet-stream",
          Metadata: meta,
          ChecksumSHA256: meta.checksum
            ? Buffer.from(meta.checksum, "hex").toString("base64")
            : undefined,
        };
      }
      case "CopyObjectCommand": {
        const source = String(input.CopySource).split("/").slice(1).join("/");
        this.copies.push(`${source} -> ${input.Key}`);
        const body = this.objects.get(source);
        if (!body) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        this.objects.set(input.Key!, Buffer.from(body));
        if (input.Metadata) this.metadata.set(input.Key!, { ...input.Metadata });
        return {};
      }
      case "DeleteObjectCommand": {
        this.deletes.push(input.Key!);
        this.objects.delete(input.Key!);
        this.metadata.delete(input.Key!);
        return {};
      }
      default:
        throw new Error(`unexpected command: ${command.constructor.name}`);
    }
  }
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body && typeof (body as { pipe?: unknown }).pipe === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  return Buffer.from(String(body ?? ""));
}

function evidenceRoot(): string {
  return process.env.HASNA_FILES_EVIDENCE_LOCAL_ROOT!;
}

function fixtureRoot(): string {
  return join(testDir, "fixtures");
}

function sha256(value: string): string {
  return sha256Buffer(Buffer.from(value));
}
