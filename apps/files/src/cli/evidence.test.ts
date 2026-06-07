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
});
