import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
let testDir: string | undefined;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("evidence CLI", () => {
  test("requires an explicit mode to emit a low-level upload URL", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-evidence-intent-"));
    const evidenceRoot = join(testDir, "evidence");
    const env = {
      ...process.env,
      HASNA_FILES_DATA_DIR: testDir,
      HASNA_FILES_DB_PATH: join(testDir, "files.db"),
      HASNA_FILES_EVIDENCE_STORAGE: "local",
      HASNA_FILES_EVIDENCE_LOCAL_ROOT: evidenceRoot,
    };
    const args = [
      "bun", "run", cliPath, "evidence", "create-upload",
      "--org", "org_hasna", "--app", "app-accounting", "--kind", "receipt",
      "--name", "receipt.txt", "--size", "13", "--checksum", "a".repeat(64),
      "--storage", "local", "--local-root", evidenceRoot, "--json",
    ];

    const redacted = Bun.spawnSync({ cmd: args, env, stdout: "pipe", stderr: "pipe" });
    expect(redacted.exitCode).toBe(0);
    const redactedOutput = new TextDecoder().decode(redacted.stdout);
    expect(redactedOutput).not.toContain("upload_url");

    const explicit = Bun.spawnSync({
      cmd: [...args, "--include-upload-url"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(explicit.exitCode).toBe(0);
    const explicitOutput = JSON.parse(new TextDecoder().decode(explicit.stdout)) as { intent: { upload_url?: string } };
    expect(explicitOutput.intent.upload_url).toStartWith("file:");
  });

  test("uploads a local file through the registered evidence command", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-evidence-cli-"));
    const dataDir = testDir;
    const evidenceRoot = join(testDir, "evidence");
    const fixture = join(testDir, "receipt.txt");
    writeFileSync(fixture, "receipt bytes");

    const upload = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "evidence",
        "upload",
        fixture,
        "--org",
        "org_hasna",
        "--company",
        "co_us",
        "--app",
        "app-accounting",
        "--kind",
        "receipt",
        "--storage",
        "local",
        "--local-root",
        evidenceRoot,
        "--json",
      ],
      env: {
        ...process.env,
        HASNA_FILES_DATA_DIR: dataDir,
        HASNA_FILES_DB_PATH: join(dataDir, "files.db"),
        HASNA_FILES_EVIDENCE_STORAGE: "local",
        HASNA_FILES_EVIDENCE_LOCAL_ROOT: evidenceRoot,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(upload.exitCode).toBe(0);
    const output = JSON.parse(new TextDecoder().decode(upload.stdout)) as {
      asset: { app: string; kind: string; status: string; scan_status: string; storage_provider: string };
      intent: { upload_url?: string };
    };
    expect(output.asset).toMatchObject({
      app: "app-accounting",
      kind: "receipt",
      status: "verified",
      scan_status: "skipped",
      storage_provider: "local",
    });
    expect(output.intent.upload_url).toBeUndefined();
    expect(new TextDecoder().decode(upload.stdout)).not.toContain("upload_url");
  });

  test("verify locates bytes via the persisted root when --local-root is not re-passed", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-evidence-root-"));
    const dataDir = testDir;
    // A custom root that is NOT the default (<dataDir>/evidence) and is NOT set
    // via the env fallback — the only way verify can find the bytes is if the
    // upload persisted the resolved root on the asset.
    const customRoot = join(testDir, "custom-vault");
    const fixture = join(testDir, "receipt.txt");
    writeFileSync(fixture, "receipt bytes for persisted-root regression");

    // Env deliberately omits HASNA_FILES_EVIDENCE_LOCAL_ROOT so nothing but the
    // persisted asset root can point verify at the custom vault.
    const env = {
      ...process.env,
      HASNA_FILES_DATA_DIR: dataDir,
      HASNA_FILES_DB_PATH: join(dataDir, "files.db"),
      HASNA_FILES_EVIDENCE_STORAGE: "local",
    };
    delete (env as Record<string, string | undefined>).HASNA_FILES_EVIDENCE_LOCAL_ROOT;

    const upload = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "evidence", "upload", fixture,
        "--org", "org_hasna", "--app", "app-accounting", "--kind", "receipt",
        "--storage", "local", "--local-root", customRoot, "--json"],
      env, stdout: "pipe", stderr: "pipe",
    });
    expect(upload.exitCode).toBe(0);
    const uploaded = JSON.parse(new TextDecoder().decode(upload.stdout)) as { asset: { id: string; bucket?: string } };
    expect(uploaded.asset.bucket).toBe(customRoot);

    // Separate invocation, NO --local-root: verify must still find the object.
    const verify = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "evidence", "verify", uploaded.asset.id, "--json"],
      env, stdout: "pipe", stderr: "pipe",
    });
    expect(verify.exitCode).toBe(0);
    const verified = JSON.parse(new TextDecoder().decode(verify.stdout)) as { ok: boolean; diagnostics: string[] };
    expect(verified.diagnostics).toEqual([]);
    expect(verified.ok).toBe(true);
  });

  test("writes, filters, replays, and protects immutable authority metadata", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-evidence-authority-cli-"));
    const evidenceRoot = join(testDir, "evidence");
    const fixture = join(testDir, "synthetic-evidence.txt");
    writeFileSync(fixture, "synthetic immutable evidence");
    const env = {
      ...process.env,
      HASNA_FILES_DATA_DIR: testDir,
      HASNA_FILES_DB_PATH: join(testDir, "files.db"),
      HASNA_FILES_EVIDENCE_STORAGE: "local",
      HASNA_FILES_EVIDENCE_LOCAL_ROOT: evidenceRoot,
    };
    const args = [
      "bun", "run", cliPath, "evidence", "upload", fixture,
      "--org", "org_synthetic",
      "--company", "co_synthetic",
      "--app", "app-monthly-filing",
      "--kind", "supporting_document",
      "--classification", "restricted",
      "--retention-policy", "seven_year_records",
      "--provenance-type", "monthly_filing",
      "--provenance-id", "filing_synthetic_cli",
      "--provenance-ref", "monthly-filing://filing/synthetic-cli",
      "--evidence-version", "4",
      "--external-ref", "invoices://invoice/synthetic-cli",
      "--idempotency-key", "monthly-filing:synthetic-cli:v4",
      "--storage", "local",
      "--local-root", evidenceRoot,
      "--json",
    ];

    const first = Bun.spawnSync({ cmd: args, env, stdout: "pipe", stderr: "pipe" });
    expect(first.exitCode).toBe(0);
    const created = JSON.parse(new TextDecoder().decode(first.stdout)) as {
      replayed: boolean;
      asset: {
        id: string;
        version: number;
        canonical_ref: string;
        provenance_type: string;
        provenance_id: string;
        provenance_ref?: string;
        external_references: string[];
        immutable: boolean;
      };
      intent: { id: string };
    };
    expect(created.replayed).toBe(false);
    expect(created.asset).toMatchObject({
      version: 4,
      provenance_type: "monthly_filing",
      provenance_id: "filing_synthetic_cli",
      provenance_ref: "monthly-filing://filing/synthetic-cli",
      external_references: ["invoices://invoice/synthetic-cli"],
      immutable: true,
    });
    expect(created.asset.canonical_ref).toBe(`open-files://evidence/${created.asset.id}/versions/4`);

    const replay = Bun.spawnSync({ cmd: args, env, stdout: "pipe", stderr: "pipe" });
    expect(replay.exitCode).toBe(0);
    const replayed = JSON.parse(new TextDecoder().decode(replay.stdout)) as {
      replayed: boolean;
      asset: { id: string };
      intent: { id: string };
    };
    expect(replayed).toMatchObject({
      replayed: true,
      asset: { id: created.asset.id },
      intent: { id: created.intent.id },
    });

    const list = Bun.spawnSync({
      cmd: [
        "bun", "run", cliPath, "evidence", "list",
        "--provenance-type", "monthly_filing",
        "--provenance-id", "filing_synthetic_cli",
        "--provenance-ref", "monthly-filing://filing/synthetic-cli",
        "--evidence-version", "4",
        "--classification", "restricted",
        "--retention-policy", "seven_year_records",
        "--external-ref", "invoices://invoice/synthetic-cli",
        "--json",
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(list.exitCode).toBe(0);
    expect((JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{ id: string }>).map((asset) => asset.id))
      .toEqual([created.asset.id]);

    writeFileSync(fixture, "mutated synthetic evidence");
    const mutation = Bun.spawnSync({ cmd: args, env, stdout: "pipe", stderr: "pipe" });
    expect(mutation.exitCode).toBe(1);
    expect(new TextDecoder().decode(mutation.stderr)).toMatch(/immutable evidence replay conflict/i);
  });
});
