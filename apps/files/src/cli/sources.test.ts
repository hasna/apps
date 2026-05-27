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
        "s3://hasna-xyz-prod-emails/drive",
        "--region",
        "us-west-2",
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
      bucket: "hasna-xyz-prod-emails",
      prefix: "drive",
      region: "us-west-2",
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
        "s3://hasna-xyz-prod-emails",
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

  test("bootstraps prod-emails Drive archive by updating a stale bucket source and setting Drive default", () => {
    const env = cliEnv();
    const stale = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", "s3://hasna-prod-files", "--name", "prod-files"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stale.exitCode).toBe(0);

    const bootstrap = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "bootstrap-prod-emails", "--json"],
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
      name: "prod-emails-drive",
      bucket: "hasna-xyz-prod-emails",
      prefix: "drive",
      region: "us-west-2",
      config: { profile: "hasna-xyz-infra" },
    });
    expect(bootstrapped.google_drive_default_destination_source_id).toBe(bootstrapped.source.id);

    const list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sources = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{ type: string; bucket?: string; prefix?: string }>;
    expect(sources.filter((source) => source.type === "s3")).toEqual([
      expect.objectContaining({ bucket: "hasna-xyz-prod-emails", prefix: "drive" }),
    ]);

    const config = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "config", "get", "google_drive_default_destination_source_id"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(JSON.parse(new TextDecoder().decode(config.stdout))).toBe(bootstrapped.source.id);
  });

  test("bootstraps the S3 source used by enabled Drive sources before disabled legacy duplicates", () => {
    const env = cliEnv();
    const disabledLegacy = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", "s3://hasna-prod-files", "--name", "prod-files"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(disabledLegacy.exitCode).toBe(0);

    let list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const disabledId = (JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{ id: string }>)[0]!.id;
    expect(Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "disable", disabledId],
      env,
      stdout: "pipe",
      stderr: "pipe",
    }).exitCode).toBe(0);

    const activeLegacy = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", "s3://hasna-xyz-prod-files", "--name", "prod-files"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(activeLegacy.exitCode).toBe(0);

    list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const activeId = (JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{
      id: string;
      type: string;
      enabled: boolean;
    }>).find((source) => source.type === "s3" && source.enabled)!.id;

    const drive = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "sources",
        "add-google-drive",
        "--profile",
        "andreihasnacom",
        "--include-my-drive",
        "--destination-source",
        activeId,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(drive.exitCode).toBe(0);

    const bootstrap = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "bootstrap-prod-files", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(bootstrap.exitCode).toBe(0);
    const bootstrapped = JSON.parse(new TextDecoder().decode(bootstrap.stdout)) as {
      source: { id: string; bucket?: string; prefix?: string };
      google_drive_default_destination_source_id?: string;
      updated_google_drive_source_ids: string[];
      disabled_legacy_source_ids: string[];
    };

    expect(bootstrapped.source.id).toBe(activeId);
    expect(bootstrapped.source).toMatchObject({
      bucket: "hasna-xyz-prod-emails",
      prefix: "drive",
    });
    expect(bootstrapped.google_drive_default_destination_source_id).toBe(activeId);
    expect(bootstrapped.updated_google_drive_source_ids).toEqual([]);
    expect(bootstrapped.disabled_legacy_source_ids).toEqual([]);

    list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sources = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{
      id: string;
      type: string;
      bucket?: string;
      enabled: boolean;
    }>;
    expect(sources.find((source) => source.id === activeId)).toMatchObject({
      bucket: "hasna-xyz-prod-emails",
      enabled: true,
    });
    expect(sources.find((source) => source.id === disabledId)).toMatchObject({
      bucket: "hasna-prod-files",
      enabled: false,
    });
  });

  test("repairs Drive source destinations that point at disabled legacy S3 sources", () => {
    const env = cliEnv();
    const legacy = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "add", "s3://hasna-xyz-prod-files/google-drive", "--name", "prod-files"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(legacy.exitCode).toBe(0);

    let list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const legacyId = (JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{ id: string }>)[0]!.id;

    const drive = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        cliPath,
        "sources",
        "add-google-drive",
        "--profile",
        "andreihasnacom",
        "--include-my-drive",
        "--destination-source",
        legacyId,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(drive.exitCode).toBe(0);

    expect(Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "disable", legacyId],
      env,
      stdout: "pipe",
      stderr: "pipe",
    }).exitCode).toBe(0);

    const bootstrap = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "bootstrap-prod-files", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(bootstrap.exitCode).toBe(0);
    const bootstrapped = JSON.parse(new TextDecoder().decode(bootstrap.stdout)) as {
      source: { id: string; bucket?: string; prefix?: string };
      updated_google_drive_source_ids: string[];
    };
    expect(bootstrapped.source.id).toBe(legacyId);
    expect(bootstrapped.source).toMatchObject({
      bucket: "hasna-xyz-prod-emails",
      prefix: "drive",
    });
    expect(bootstrapped.updated_google_drive_source_ids).toEqual([]);

    list = Bun.spawnSync({
      cmd: ["bun", "run", cliPath, "sources", "list", "--json"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const sources = JSON.parse(new TextDecoder().decode(list.stdout)) as Array<{
      id: string;
      type: string;
      config: { destination_source_id?: string };
    }>;
    const driveSource = sources.find((source) => source.type === "google_drive")!;
    expect(driveSource.config.destination_source_id).toBe(legacyId);
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
