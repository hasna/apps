import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function run(args: string[], env: Record<string, string | undefined> = {}) {
  const home = mkdtempSync(join(tmpdir(), "instructions-storage-cli-"));
  roots.push(home);
  const result = Bun.spawnSync([process.execPath, "src/cli/index.tsx", "storage", ...args], {
    cwd: join(import.meta.dir, "../.."),
    env: {
      ...process.env,
      HOME: home,
      HASNA_HOME: home,
      HASNA_STATION: "instructions-storage-test",
      HASNA_INSTRUCTIONS_API_URL: undefined,
      HASNA_INSTRUCTIONS_API_KEY: undefined,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { home, result };
}

describe("instructions storage S3 CLI", () => {
  test("status is redacted and never opens SQLite", () => {
    const { home, result } = run(["status", "--json"], {
      HASNA_INSTRUCTIONS_S3_BUCKET: "instructions-test-bucket",
      HASNA_INSTRUCTIONS_S3_ACCESS_KEY_ID: "fixture-access",
      HASNA_INSTRUCTIONS_S3_SECRET_ACCESS_KEY: "fixture-secret",
    });
    expect(result.exitCode).toBe(0);
    const status = JSON.parse(result.stdout.toString());
    expect(status).toMatchObject({ configured: true, provider: "s3", credentialSource: "static-explicit", includesCredentialValues: false, databaseAuthority: false });
    expect(result.stdout.toString()).not.toContain("fixture-access");
    expect(result.stdout.toString()).not.toContain("fixture-secret");
    expect(existsSync(join(home, ".hasna", "instructions", "instructions.db"))).toBe(false);
  });

  test("push --dry-run hashes and plans without a network request", () => {
    const root = mkdtempSync(join(tmpdir(), "instructions-storage-payload-"));
    roots.push(root);
    const file = join(root, "instructions.tgz");
    writeFileSync(file, "portable instructions backup\n");
    const { result } = run(["backup", "push", file, "--id", "backup-2026-09-15", "--dry-run", "--json"], {
      HASNA_INSTRUCTIONS_S3_BUCKET: "instructions-test-bucket",
      HASNA_INSTRUCTIONS_S3_ACCESS_KEY_ID: "not-used",
      HASNA_INSTRUCTIONS_S3_SECRET_ACCESS_KEY: "not-used",
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({ operation: "push", dryRun: true, noNetwork: true, backupId: "backup-2026-09-15", sizeBytes: 29 });
  });

  test("S3 configuration without a bucket fails closed", () => {
    const { result } = run(["status", "--json"], { HASNA_INSTRUCTIONS_S3_PREFIX: "instructions/" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("HASNA_INSTRUCTIONS_S3_BUCKET");
  });
});
