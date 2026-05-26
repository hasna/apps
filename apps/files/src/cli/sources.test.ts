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

describe("sources CLI", () => {
  test("persists AWS profile on S3 sources", () => {
    const env = cliEnv();
    const add = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "sources",
        "add",
        "s3://hasna-xyz-prod-files/google-drive",
        "--region",
        "us-east-1",
        "--aws-profile",
        "hasna-xyz-infra",
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(add.exitCode).toBe(0);

    const list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sources = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{
      bucket?: string;
      prefix?: string;
      region?: string;
      config?: { profile?: string };
    }>;

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      bucket: "hasna-xyz-prod-files",
      prefix: "google-drive",
      region: "us-east-1",
      config: { profile: "hasna-xyz-infra" },
    });
  });

  test("rejects mixing AWS profile and static S3 credentials", () => {
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "sources",
        "add",
        "s3://hasna-xyz-prod-files",
        "--aws-profile",
        "hasna-xyz-infra",
        "--access-key",
        "static-access",
        "--secret-key",
        "static-secret",
      ],
      env: cliEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stderr)).toContain("Use either --aws-profile");
  });

  test("bootstraps prod-files by updating a stale bucket source and setting Drive default", () => {
    const env = cliEnv();
    const stale = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", "s3://hasna-prod-files", "--name", "prod-files"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stale.exitCode).toBe(0);

    const bootstrap = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "bootstrap-prod-files", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(bootstrap.exitCode).toBe(0);
    const bootstrapped = JSON.parse(new TextDecoder().decode(bootstrap.stdout)) as {
      source: { id: string; bucket?: string; name: string; config?: { profile?: string } };
      google_drive_default_destination_source_id?: string;
    };

    expect(bootstrapped.source).toMatchObject({
      name: "prod-files",
      bucket: "hasna-xyz-prod-files",
      config: { profile: "hasna-xyz-infra" },
    });
    expect(bootstrapped.google_drive_default_destination_source_id).toBe(bootstrapped.source.id);

    const list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sources = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{ type: string; bucket?: string }>;
    expect(sources.filter((source) => source.type === "s3")).toEqual([
      expect.objectContaining({ bucket: "hasna-xyz-prod-files" }),
    ]);

    const config = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "config", "get", "google_drive_default_destination_source_id"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(JSON.parse(new TextDecoder().decode(config.stdout))).toBe(bootstrapped.source.id);
  });
});

function cliEnv(): NodeJS.ProcessEnv {
  testDir = mkdtempSync(join(tmpdir(), "open-files-cli-"));
  return {
    ...process.env,
    HASNA_FILES_DATA_DIR: testDir,
    HASNA_FILES_DB_PATH: join(testDir, "files.db"),
  };
}
