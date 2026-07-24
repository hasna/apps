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
        "iapp-accounting",
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
    };
    expect(output.asset).toMatchObject({
      app: "iapp-accounting",
      kind: "receipt",
      status: "verified",
      scan_status: "skipped",
      storage_provider: "local",
    });
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
        "--org", "org_hasna", "--app", "iapp-accounting", "--kind", "receipt",
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
});
