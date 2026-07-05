import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const cliPath = join(process.cwd(), "src/cli/index.tsx");
let testDir: string | undefined;

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("storage CLI", () => {
  test("prints local and remote storage status as JSON", () => {
    testDir = mkdtempSync(join(tmpdir(), "files-storage-cli-"));
    const result = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "storage", "status", "--json"],
      env: {
        ...process.env,
        HASNA_FILES_DATA_DIR: testDir,
        HASNA_FILES_DB_PATH: join(testDir, "files.db"),
        HASNA_FILES_DATABASE_URL: "postgres://files_user:secret@example.test:5432/files",
        HASNA_FILES_S3_BUCKET: "hasna-xyz-opensource-files-prod",
        HASNA_FILES_S3_PREFIX: "objects",
        HASNA_FILES_AWS_REGION: "us-east-1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(new TextDecoder().decode(result.stdout)) as {
      mode: string;
      remote_configured: boolean;
      object_storage: { bucket?: string; prefix?: string };
      runtime: {
        local_index: { provider: string };
        remote_metadata: { provider: string; sync: string };
        object_bytes: { provider: string; writes: string };
        boundary: { metadata_sync_moves_object_bytes: boolean };
      };
      tables: Array<{ table: string; rows: number }>;
    };
    expect(output.mode).toBe("hybrid");
    expect(output.remote_configured).toBe(true);
    expect(output.object_storage).toMatchObject({
      bucket: "hasna-xyz-opensource-files-prod",
      prefix: "objects",
    });
    expect(output.runtime).toMatchObject({
      local_index: { provider: "sqlite" },
      remote_metadata: { provider: "postgres", sync: "explicit_migrate_push_pull_sync" },
      object_bytes: { provider: "s3", writes: "explicit_object_store_apis" },
      boundary: { metadata_sync_moves_object_bytes: false },
    });
    expect(output.tables.map((table) => table.table)).toContain("file_assets");
    expect(output.tables.map((table) => table.table)).toContain("s3_objects");
    expect(output.tables.map((table) => table.table)).toContain("file_versions");
    expect(output.tables.map((table) => table.table)).not.toContain("files_fts");
  });
});
